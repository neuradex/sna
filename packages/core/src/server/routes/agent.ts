/**
 * Agent routes — HTTP API for spawning and communicating with agent providers.
 *
 * Routes:
 *   POST /start?session=<id>   — start agent in a session (default: "default")
 *   POST /send?session=<id>    — send a message to a session
 *   GET  /events?session=<id>  — SSE stream for a session
 *   POST /kill?session=<id>    — kill agent in a session
 *   GET  /status?session=<id>  — check session status
 *
 *   POST /sessions             — create a new session
 *   GET  /sessions             — list all sessions
 *   DELETE /sessions/:id       — remove a session
 *
 *   POST /run-once             — one-shot: spawn → execute → return result → cleanup
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getProvider,
  type AgentEvent,
} from "../../core/providers/index.js";
import { logger } from "../../lib/logger.js";
import { getDb } from "../../db/schema.js";
import { SessionManager } from "../session-manager.js";
import { httpJson } from "../api-types.js";

/** Helper: read session ID from query string, default "default". */
function getSessionId(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query("session") ?? "default";
}

// ── run-once shared logic ─────────────────────────────────────────

const DEFAULT_RUN_ONCE_TIMEOUT = 120_000; // 2 minutes

export interface RunOnceOptions {
  message: string;
  model?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  permissionMode?: string;
  cwd?: string;
  timeout?: number;
  provider?: string;
  extraArgs?: string[];
}

export interface RunOnceResult {
  result: string;
  usage: Record<string, unknown> | null;
}

/**
 * One-shot agent execution: create temp session → spawn → wait for result → cleanup.
 * Used by both HTTP POST /run-once and WS agent.run-once.
 */
export async function runOnce(
  sessionManager: SessionManager,
  opts: RunOnceOptions,
): Promise<RunOnceResult> {
  const sessionId = `run-once-${crypto.randomUUID().slice(0, 8)}`;
  const timeout = opts.timeout ?? DEFAULT_RUN_ONCE_TIMEOUT;

  const session = sessionManager.createSession({
    id: sessionId,
    label: "run-once",
    cwd: opts.cwd ?? process.cwd(),
  });

  const provider = getProvider(opts.provider ?? "claude-code");

  const extraArgs: string[] = opts.extraArgs ? [...opts.extraArgs] : [];
  // --max-turns 1: auto-exit after one response turn
  // --bare: skip hooks, LSP, plugins, CLAUDE.md for faster startup
  // --no-session-persistence: don't save this throwaway session
  extraArgs.push("--max-turns", "1", "--bare", "--no-session-persistence");
  if (opts.systemPrompt) extraArgs.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) extraArgs.push("--append-system-prompt", opts.appendSystemPrompt);

  const proc = provider.spawn({
    cwd: session.cwd,
    prompt: opts.message,
    model: opts.model ?? "claude-sonnet-4-6",
    permissionMode: (opts.permissionMode as any) ?? "bypassPermissions",
    env: { SNA_SESSION_ID: sessionId },
    extraArgs,
  });

  sessionManager.setProcess(sessionId, proc);

  try {
    const result = await new Promise<RunOnceResult>((resolve, reject) => {
      const texts: string[] = [];
      let usage: Record<string, unknown> | null = null;

      const timer = setTimeout(() => {
        reject(new Error(`run-once timed out after ${timeout}ms`));
      }, timeout);

      const unsub = sessionManager.onSessionEvent(sessionId, (_cursor, e) => {
        if (e.type === "assistant" && e.message) {
          texts.push(e.message);
        }
        if (e.type === "complete") {
          clearTimeout(timer);
          unsub();
          usage = (e.data as Record<string, unknown>) ?? null;
          resolve({ result: texts.join("\n"), usage });
        }
        if (e.type === "error") {
          clearTimeout(timer);
          unsub();
          reject(new Error(e.message ?? "Agent error"));
        }
      });
    });

    return result;
  } finally {
    sessionManager.killSession(sessionId);
    sessionManager.removeSession(sessionId);
  }
}

export function createAgentRoutes(sessionManager: SessionManager) {
  const app = new Hono();

  // ── Session CRUD ──────────────────────────────────────────────

  // POST /sessions — create a new session
  app.post("/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: string;
      cwd?: string;
      meta?: Record<string, unknown>;
    };

    try {
      const session = sessionManager.createSession({
        label: body.label,
        cwd: body.cwd,
        meta: body.meta,
      });

      logger.log("route", `POST /sessions → created "${session.id}"`);
      return httpJson(c, "sessions.create", { status: "created", sessionId: session.id, label: session.label, meta: session.meta });
    } catch (e: any) {
      logger.err("err", `POST /sessions → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 409);
    }
  });

  // GET /sessions — list all sessions
  app.get("/sessions", (c) => {
    return httpJson(c, "sessions.list", { sessions: sessionManager.listSessions() });
  });

  // DELETE /sessions/:id — remove a session
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot remove default session" }, 400);
    }
    const removed = sessionManager.removeSession(id);
    if (!removed) {
      return c.json({ status: "error", message: "Session not found" }, 404);
    }
    logger.log("route", `DELETE /sessions/${id} → removed`);
    return httpJson(c, "sessions.remove", { status: "removed" });
  });

  // ── One-shot execution ─────────────────────────────────────────

  // POST /run-once — spawn → execute → return result → cleanup
  app.post("/run-once", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as RunOnceOptions;
    if (!body.message) {
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    try {
      const result = await runOnce(sessionManager, body);
      return httpJson(c, "agent.run-once", result);
    } catch (e: any) {
      logger.err("err", `POST /run-once → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // ── Agent lifecycle (session-scoped) ──────────────────────────

  // POST /start — start agent in a session (idempotent)
  app.post("/start", async (c) => {
    const sessionId = getSessionId(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      provider?: string;
      prompt?: string;
      model?: string;
      permissionMode?: string;
      force?: boolean;
      meta?: Record<string, unknown>;
      extraArgs?: string[];
      cwd?: string;
    };

    // Auto-create session if it doesn't exist (backward compat for "default")
    const session = sessionManager.getOrCreateSession(sessionId, {
      cwd: body.cwd,
    });

    // If agent is already alive and not forced, return existing session
    if (session.process?.alive && !body.force) {
      logger.log("route", `POST /start?session=${sessionId} → already_running`);
      return httpJson(c, "agent.start", {
        status: "already_running",
        provider: "claude-code",
        sessionId: session.process.sessionId ?? session.id,
      });
    }

    // Kill existing
    if (session.process?.alive) {
      session.process.kill();
    }
    // Clear buffer but keep eventCounter — SSE cursors depend on monotonic IDs
    session.eventBuffer.length = 0;

    const provider = getProvider(body.provider ?? "claude-code");

    // Persist initial prompt as user message + record invoked event
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(sessionId, session.label ?? sessionId);
      if (body.prompt) {
        db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`)
          .run(sessionId, body.prompt, body.meta ? JSON.stringify(body.meta) : null);
      }
      const skillMatch = body.prompt?.match(/^Execute the skill:\s*(\S+)/);
      if (skillMatch) {
        db.prepare(
          `INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`
        ).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
      }
    } catch { /* DB not ready — non-fatal */ }

    const providerName = body.provider ?? "claude-code";
    const model = body.model ?? "claude-sonnet-4-6";
    const permissionMode = body.permissionMode ?? "acceptEdits";
    const extraArgs = body.extraArgs;

    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode: permissionMode as any,
        env: { SNA_SESSION_ID: sessionId },
        extraArgs,
      });

      sessionManager.setProcess(sessionId, proc);
      sessionManager.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, extraArgs });
      logger.log("route", `POST /start?session=${sessionId} → started`);

      return httpJson(c, "agent.start", {
        status: "started",
        provider: provider.name,
        sessionId: session.id,
      });
    } catch (e: any) {
      logger.err("err", `POST /start?session=${sessionId} failed: ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // POST /send — send a message to the agent
  app.post("/send", async (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);

    if (!session?.process?.alive) {
      logger.err("err", `POST /send?session=${sessionId} → no active session`);
      return c.json(
        { status: "error", message: `No active agent session "${sessionId}". Call POST /start first.` },
        400,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
      meta?: Record<string, unknown>;
    };
    if (!body.message) {
      logger.err("err", `POST /send?session=${sessionId} → empty message`);
      return c.json({ status: "error", message: "message is required" }, 400);
    }

    // Persist user message with optional metadata
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(sessionId, session.label ?? sessionId);
      db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`)
        .run(sessionId, body.message, body.meta ? JSON.stringify(body.meta) : null);
    } catch { /* DB write failure is non-fatal */ }

    session.state = "processing";
    sessionManager.touch(sessionId);
    logger.log("route", `POST /send?session=${sessionId} → "${body.message.slice(0, 80)}"`);
    session.process.send(body.message);
    return httpJson(c, "agent.send", { status: "sent" });
  });

  // GET /events — SSE stream (stays open indefinitely)
  app.get("/events", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getOrCreateSession(sessionId);

    const sinceParam = c.req.query("since");
    let cursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;

    return streamSSE(c, async (stream) => {
      const POLL_MS = 300;
      const KEEPALIVE_MS = 15_000;
      let lastSend = Date.now();

      while (true) {
        if (cursor < session.eventCounter) {
          const startIdx = Math.max(
            0,
            session.eventBuffer.length - (session.eventCounter - cursor),
          );
          const newEvents = session.eventBuffer.slice(startIdx);

          for (const event of newEvents) {
            cursor++;
            await stream.writeSSE({
              id: String(cursor),
              data: JSON.stringify(event),
            });
            lastSend = Date.now();
          }
        }

        if (Date.now() - lastSend > KEEPALIVE_MS) {
          await stream.writeSSE({ data: "" });
          lastSend = Date.now();
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    });
  });

  // POST /restart — kill + re-spawn with merged config + --resume
  app.post("/restart", async (c) => {
    const sessionId = getSessionId(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      provider?: string;
      model?: string;
      permissionMode?: string;
      extraArgs?: string[];
    };

    try {
      const ccSessionId = sessionManager.getSession(sessionId)?.ccSessionId;
      const { config } = sessionManager.restartSession(sessionId, body, (cfg) => {
        const prov = getProvider(cfg.provider);
        const resumeArgs = ccSessionId ? ["--resume", ccSessionId] : ["--resume"];
        return prov.spawn({
          cwd: sessionManager.getSession(sessionId)!.cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode as any,
          env: { SNA_SESSION_ID: sessionId },
          extraArgs: [...(cfg.extraArgs ?? []), ...resumeArgs],
        });
      });
      logger.log("route", `POST /restart?session=${sessionId} → restarted`);
      return httpJson(c, "agent.restart", {
        status: "restarted",
        provider: config.provider,
        sessionId,
      });
    } catch (e: any) {
      logger.err("err", `POST /restart?session=${sessionId} → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // POST /interrupt — interrupt current turn (SIGINT), process stays alive
  app.post("/interrupt", async (c) => {
    const sessionId = getSessionId(c);
    const interrupted = sessionManager.interruptSession(sessionId);
    return httpJson(c, "agent.interrupt", { status: interrupted ? "interrupted" : "no_session" });
  });

  // POST /kill
  app.post("/kill", async (c) => {
    const sessionId = getSessionId(c);
    const killed = sessionManager.killSession(sessionId);
    return httpJson(c, "agent.kill", { status: killed ? "killed" : "no_session" });
  });

  // GET /status
  app.get("/status", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
    return httpJson(c, "agent.status", {
      alive: session?.process?.alive ?? false,
      sessionId: session?.process?.sessionId ?? null,
      eventCount: session?.eventCounter ?? 0,
    });
  });

  // ── Permission approval flow ────────────────────────────────────

  // POST /permission-request — called by hook.ts (sync) to submit a request and wait
  app.post("/permission-request", async (c) => {
    const sessionId = getSessionId(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      tool_name?: string;
      tool_input?: Record<string, unknown>;
    };

    logger.log("route", `POST /permission-request?session=${sessionId} → ${body.tool_name}`);

    const result = await sessionManager.createPendingPermission(sessionId, body);
    return c.json({ approved: result });
  });

  // POST /permission-respond — called by UI to approve/deny
  app.post("/permission-respond", async (c) => {
    const sessionId = getSessionId(c);
    const body = (await c.req.json().catch(() => ({}))) as { approved?: boolean };
    const approved = body.approved ?? false;

    const resolved = sessionManager.resolvePendingPermission(sessionId, approved);
    if (!resolved) {
      return c.json({ status: "error", message: "No pending permission request" }, 404);
    }

    logger.log("route", `POST /permission-respond?session=${sessionId} → ${approved ? "approved" : "denied"}`);
    return httpJson(c, "permission.respond", { status: approved ? "approved" : "denied" });
  });

  // GET /permission-pending — UI polls this to check for pending requests
  // Always returns { pending: Array } for consistent typing
  app.get("/permission-pending", (c) => {
    const sessionId = c.req.query("session");

    if (sessionId) {
      const pending = sessionManager.getPendingPermission(sessionId);
      return httpJson(c, "permission.pending", { pending: pending ? [{ sessionId, ...pending }] : [] });
    }

    // No session specified — return all pending
    return httpJson(c, "permission.pending", { pending: sessionManager.getAllPendingPermissions() });
  });

  return app;
}
