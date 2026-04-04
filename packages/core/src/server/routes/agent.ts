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
import { buildHistoryFromDb } from "../history-builder.js";
import { httpJson } from "../api-types.js";
import { saveImages } from "../image-store.js";
import { getConfig } from "../../config.js";

/** Helper: read session ID from query string, default "default". */
function getSessionId(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query("session") ?? "default";
}

// ── run-once shared logic ─────────────────────────────────────────

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
  const timeout = opts.timeout ?? getConfig().runOnceTimeoutMs;

  const session = sessionManager.createSession({
    id: sessionId,
    label: "run-once",
    cwd: opts.cwd ?? process.cwd(),
  });

  const cfg = getConfig();
  const provider = getProvider(opts.provider ?? cfg.defaultProvider);

  const extraArgs: string[] = opts.extraArgs ? [...opts.extraArgs] : [];
  if (opts.systemPrompt) extraArgs.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) extraArgs.push("--append-system-prompt", opts.appendSystemPrompt);

  const proc = provider.spawn({
    cwd: session.cwd,
    prompt: opts.message,
    model: opts.model ?? cfg.model,
    permissionMode: (opts.permissionMode as any) ?? cfg.defaultPermissionMode,
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
      id?: string;
      label?: string;
      cwd?: string;
      meta?: Record<string, unknown>;
    };

    try {
      const session = sessionManager.createSession({
        id: body.id,
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
      configDir?: string;
      force?: boolean;
      meta?: Record<string, unknown>;
      extraArgs?: string[];
      cwd?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
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
        provider: getConfig().defaultProvider,
        sessionId: session.process.sessionId ?? session.id,
      });
    }

    // Kill existing
    if (session.process?.alive) {
      session.process.kill();
    }

    const provider = getProvider(body.provider ?? getConfig().defaultProvider);

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

    const providerName = body.provider ?? getConfig().defaultProvider;
    const model = body.model ?? getConfig().model;
    const permissionMode = body.permissionMode;
    const configDir = body.configDir;
    const extraArgs = body.extraArgs;

    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode: permissionMode as any,
        configDir,
        env: { SNA_SESSION_ID: sessionId },
        history: body.history,
        extraArgs,
      });

      sessionManager.setProcess(sessionId, proc);
      sessionManager.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, configDir, extraArgs });
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
      images?: Array<{ base64: string; mimeType: string }>;
      meta?: Record<string, unknown>;
    };
    if (!body.message && !body.images?.length) {
      logger.err("err", `POST /send?session=${sessionId} → empty message`);
      return c.json({ status: "error", message: "message or images required" }, 400);
    }

    // Save images to disk and persist message with image filenames in meta
    const textContent = body.message ?? "(image)";
    let meta: Record<string, unknown> = body.meta ? { ...body.meta } : {};
    if (body.images?.length) {
      const filenames = saveImages(sessionId, body.images);
      meta.images = filenames;
    }
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(sessionId, session.label ?? sessionId);
      db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`)
        .run(sessionId, textContent, Object.keys(meta).length > 0 ? JSON.stringify(meta) : null);
    } catch { /* DB write failure is non-fatal */ }

    // Broadcast user message to agent.subscribe listeners (multi-client sync)
    sessionManager.pushEvent(sessionId, {
      type: "user_message",
      message: textContent,
      data: Object.keys(meta).length > 0 ? meta : undefined,
      timestamp: Date.now(),
    });

    sessionManager.updateSessionState(sessionId, "processing");
    sessionManager.touch(sessionId);

    // Build content: plain string or content block array with images
    if (body.images?.length) {
      const content: import("../../core/providers/types.js").ContentBlock[] = [
        ...body.images.map((img) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
        })),
        ...(body.message ? [{ type: "text" as const, text: body.message }] : []),
      ];
      logger.log("route", `POST /send?session=${sessionId} → ${body.images.length} image(s) + "${(body.message ?? "").slice(0, 40)}"`);
      session.process.send(content);
    } else {
      logger.log("route", `POST /send?session=${sessionId} → "${body.message!.slice(0, 80)}"`);
      session.process.send(body.message!);
    }
    return httpJson(c, "agent.send", { status: "sent" });
  });

  // GET /events — SSE stream (stays open indefinitely)
  app.get("/events", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getOrCreateSession(sessionId);

    const sinceParam = c.req.query("since");
    const sinceCursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;

    return streamSSE(c, async (stream) => {
      const KEEPALIVE_MS = getConfig().keepaliveIntervalMs;
      const signal = c.req.raw.signal;

      // Queue bridges sync event callbacks → async SSE writes
      const queue: Array<{ cursor: number; event: AgentEvent }> = [];
      let wakeUp: (() => void) | null = null;

      const unsub = sessionManager.onSessionEvent(sessionId, (eventCursor, event) => {
        queue.push({ cursor: eventCursor, event });
        const fn = wakeUp; wakeUp = null; fn?.();
      });
      signal.addEventListener("abort", () => { const fn = wakeUp; wakeUp = null; fn?.(); });

      try {
        // Replay buffer history for requested cursor range
        let cursor = sinceCursor;
        if (cursor < session.eventCounter) {
          const startIdx = Math.max(
            0,
            session.eventBuffer.length - (session.eventCounter - cursor),
          );
          for (const event of session.eventBuffer.slice(startIdx)) {
            cursor++;
            await stream.writeSSE({ id: String(cursor), data: JSON.stringify(event) });
          }
        } else {
          cursor = session.eventCounter;
        }

        // Drop real-time events that were already covered by buffer replay.
        // cursor=-1 events (transient deltas) always pass through.
        while (queue.length > 0 && queue[0].cursor !== -1 && queue[0].cursor <= cursor) queue.shift();

        // Event-driven loop — no polling
        while (!signal.aborted) {
          if (queue.length === 0) {
            await Promise.race([
              new Promise<void>((r) => { wakeUp = r; }),
              new Promise<void>((r) => setTimeout(r, KEEPALIVE_MS)),
            ]);
          }

          if (signal.aborted) break;

          if (queue.length > 0) {
            while (queue.length > 0) {
              const item = queue.shift()!;
              // cursor=-1 = transient event (assistant_delta) — send without SSE id
              if (item.cursor === -1) {
                await stream.writeSSE({ data: JSON.stringify(item.event) });
              } else {
                await stream.writeSSE({ id: String(item.cursor), data: JSON.stringify(item.event) });
              }
            }
          } else {
            // Keepalive — no events arrived within KEEPALIVE_MS
            await stream.writeSSE({ data: "" });
          }
        }
      } finally {
        unsub();
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
      configDir?: string;
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
          configDir: cfg.configDir,
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

  // POST /resume — resume session with DB history auto-injected
  app.post("/resume", async (c) => {
    const sessionId = getSessionId(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: string;
      model?: string;
      permissionMode?: string;
      configDir?: string;
      provider?: string;
      extraArgs?: string[];
    };

    const session = sessionManager.getOrCreateSession(sessionId);
    if (session.process?.alive) {
      return c.json({ status: "error", message: "Session already running. Use agent.send instead." }, 400);
    }

    const history = buildHistoryFromDb(sessionId);
    if (history.length === 0 && !body.prompt) {
      return c.json({ status: "error", message: "No history in DB — nothing to resume." }, 400);
    }

    const providerName = body.provider ?? getConfig().defaultProvider;
    const model = body.model ?? session.lastStartConfig?.model ?? getConfig().model;
    const permissionMode = body.permissionMode ?? session.lastStartConfig?.permissionMode;
    const configDir = body.configDir ?? session.lastStartConfig?.configDir;
    const extraArgs = body.extraArgs ?? session.lastStartConfig?.extraArgs;
    const provider = getProvider(providerName);

    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode: permissionMode as any,
        configDir,
        env: { SNA_SESSION_ID: sessionId },
        history: history.length > 0 ? history : undefined,
        extraArgs,
      });
      sessionManager.setProcess(sessionId, proc, "resumed");
      sessionManager.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, configDir, extraArgs });
      logger.log("route", `POST /resume?session=${sessionId} → resumed (${history.length} history msgs)`);
      return httpJson(c, "agent.resume", {
        status: "resumed",
        provider: providerName,
        sessionId: session.id,
        historyCount: history.length,
      });
    } catch (e: any) {
      logger.err("err", `POST /resume?session=${sessionId} → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // POST /interrupt — interrupt current turn, process stays alive
  app.post("/interrupt", async (c) => {
    const sessionId = getSessionId(c);
    const interrupted = sessionManager.interruptSession(sessionId);
    return httpJson(c, "agent.interrupt", { status: interrupted ? "interrupted" : "no_session" });
  });

  // POST /set-model — change model at runtime, no restart
  app.post("/set-model", async (c) => {
    const sessionId = getSessionId(c);
    const body = (await c.req.json().catch(() => ({}))) as { model?: string };
    if (!body.model) return c.json({ status: "error", message: "model is required" }, 400);
    const updated = sessionManager.setSessionModel(sessionId, body.model);
    return httpJson(c, "agent.set-model", { status: updated ? "updated" : "no_session", model: body.model });
  });

  // POST /set-permission-mode — change permission mode at runtime, no restart
  app.post("/set-permission-mode", async (c) => {
    const sessionId = getSessionId(c);
    const body = (await c.req.json().catch(() => ({}))) as { permissionMode?: string };
    if (!body.permissionMode) return c.json({ status: "error", message: "permissionMode is required" }, 400);
    const updated = sessionManager.setSessionPermissionMode(sessionId, body.permissionMode);
    return httpJson(c, "agent.set-permission-mode", { status: updated ? "updated" : "no_session", permissionMode: body.permissionMode });
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
    const alive = session?.process?.alive ?? false;
    let messageCount = 0;
    let lastMessage: { role: string; content: string; created_at: string } | null = null;
    try {
      const db = getDb();
      const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId) as any;
      messageCount = count?.c ?? 0;
      const last = db.prepare("SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId) as any;
      if (last) lastMessage = { role: last.role, content: last.content, created_at: last.created_at };
    } catch {}
    return httpJson(c, "agent.status", {
      alive,
      agentStatus: !alive ? "disconnected" : (session?.state === "processing" ? "busy" : "idle"),
      sessionId: session?.process?.sessionId ?? null,
      ccSessionId: session?.ccSessionId ?? null,
      eventCount: session?.eventCounter ?? 0,
      messageCount,
      lastMessage,
      config: session?.lastStartConfig ?? null,
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
