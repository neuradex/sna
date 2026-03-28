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

/** Helper: read session ID from query string, default "default". */
function getSessionId(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query("session") ?? "default";
}

export function createAgentRoutes(sessionManager: SessionManager) {
  const app = new Hono();

  // ── Session CRUD ──────────────────────────────────────────────

  // POST /sessions — create a new session
  app.post("/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: string;
      cwd?: string;
    };

    try {
      const session = sessionManager.createSession({
        label: body.label,
        cwd: body.cwd,
      });
      logger.log("route", `POST /sessions → created "${session.id}"`);
      return c.json({ status: "created", sessionId: session.id, label: session.label });
    } catch (e: any) {
      logger.err("err", `POST /sessions → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 409);
    }
  });

  // GET /sessions — list all sessions
  app.get("/sessions", (c) => {
    return c.json({ sessions: sessionManager.listSessions() });
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
    return c.json({ status: "removed" });
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
    };

    // Auto-create session if it doesn't exist (backward compat for "default")
    const session = sessionManager.getOrCreateSession(sessionId);

    // If agent is already alive and not forced, return existing session
    if (session.process?.alive && !body.force) {
      logger.log("route", `POST /start?session=${sessionId} → already_running`);
      return c.json({
        status: "already_running",
        provider: "claude-code",
        sessionId: session.process.sessionId,
      });
    }

    // Kill existing
    if (session.process?.alive) {
      session.process.kill();
    }
    // Clear buffer but keep eventCounter — SSE cursors depend on monotonic IDs
    session.eventBuffer.length = 0;

    const provider = getProvider(body.provider ?? "claude-code");

    // Record invoked event immediately — UI can show "starting" status right away
    const skillMatch = body.prompt?.match(/^Execute the skill:\s*(\S+)/);
    if (skillMatch) {
      try {
        const db = getDb();
        db.prepare(
          `INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`
        ).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
      } catch { /* DB not ready — non-fatal */ }
    }

    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model: body.model ?? "claude-sonnet-4-6",
        permissionMode: (body.permissionMode as any) ?? "acceptEdits",
        env: { SNA_SESSION_ID: sessionId },
      });

      sessionManager.setProcess(sessionId, proc);
      logger.log("route", `POST /start?session=${sessionId} → started`);

      return c.json({
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

    const body = (await c.req.json().catch(() => ({}))) as { message?: string };
    if (!body.message) {
      logger.err("err", `POST /send?session=${sessionId} → empty message`);
      return c.json({ status: "error", message: "message is required" }, 400);
    }

    sessionManager.touch(sessionId);
    logger.log("route", `POST /send?session=${sessionId} → "${body.message.slice(0, 80)}"`);
    session.process.send(body.message);
    return c.json({ status: "sent" });
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

  // POST /kill
  app.post("/kill", async (c) => {
    const sessionId = getSessionId(c);
    const killed = sessionManager.killSession(sessionId);
    return c.json({ status: killed ? "killed" : "no_session" });
  });

  // GET /status
  app.get("/status", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
    return c.json({
      alive: session?.process?.alive ?? false,
      sessionId: session?.process?.sessionId ?? null,
      eventCount: session?.eventCounter ?? 0,
    });
  });

  return app;
}
