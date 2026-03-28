import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getProvider
} from "../../core/providers/index.js";
import { logger } from "../../lib/logger.js";
import { getDb } from "../../db/schema.js";
function getSessionId(c) {
  return c.req.query("session") ?? "default";
}
function createAgentRoutes(sessionManager) {
  const app = new Hono();
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const session = sessionManager.createSession({
        label: body.label,
        cwd: body.cwd
      });
      logger.log("route", `POST /sessions \u2192 created "${session.id}"`);
      return c.json({ status: "created", sessionId: session.id, label: session.label });
    } catch (e) {
      logger.err("err", `POST /sessions \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 409);
    }
  });
  app.get("/sessions", (c) => {
    return c.json({ sessions: sessionManager.listSessions() });
  });
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot remove default session" }, 400);
    }
    const removed = sessionManager.removeSession(id);
    if (!removed) {
      return c.json({ status: "error", message: "Session not found" }, 404);
    }
    logger.log("route", `DELETE /sessions/${id} \u2192 removed`);
    return c.json({ status: "removed" });
  });
  app.post("/start", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const session = sessionManager.getOrCreateSession(sessionId);
    if (session.process?.alive && !body.force) {
      logger.log("route", `POST /start?session=${sessionId} \u2192 already_running`);
      return c.json({
        status: "already_running",
        provider: "claude-code",
        sessionId: session.process.sessionId
      });
    }
    if (session.process?.alive) {
      session.process.kill();
    }
    session.eventBuffer.length = 0;
    const provider = getProvider(body.provider ?? "claude-code");
    const skillMatch = body.prompt?.match(/^Execute the skill:\s*(\S+)/);
    if (skillMatch) {
      try {
        const db = getDb();
        db.prepare(
          `INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`
        ).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
      } catch {
      }
    }
    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model: body.model ?? "claude-sonnet-4-6",
        permissionMode: body.permissionMode ?? "acceptEdits",
        env: { SNA_SESSION_ID: sessionId }
      });
      sessionManager.setProcess(sessionId, proc);
      logger.log("route", `POST /start?session=${sessionId} \u2192 started`);
      return c.json({
        status: "started",
        provider: provider.name,
        sessionId: session.id
      });
    } catch (e) {
      logger.err("err", `POST /start?session=${sessionId} failed: ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/send", async (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
    if (!session?.process?.alive) {
      logger.err("err", `POST /send?session=${sessionId} \u2192 no active session`);
      return c.json(
        { status: "error", message: `No active agent session "${sessionId}". Call POST /start first.` },
        400
      );
    }
    const body = await c.req.json().catch(() => ({}));
    if (!body.message) {
      logger.err("err", `POST /send?session=${sessionId} \u2192 empty message`);
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    sessionManager.touch(sessionId);
    logger.log("route", `POST /send?session=${sessionId} \u2192 "${body.message.slice(0, 80)}"`);
    session.process.send(body.message);
    return c.json({ status: "sent" });
  });
  app.get("/events", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getOrCreateSession(sessionId);
    const sinceParam = c.req.query("since");
    let cursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;
    return streamSSE(c, async (stream) => {
      const POLL_MS = 300;
      const KEEPALIVE_MS = 15e3;
      let lastSend = Date.now();
      while (true) {
        if (cursor < session.eventCounter) {
          const startIdx = Math.max(
            0,
            session.eventBuffer.length - (session.eventCounter - cursor)
          );
          const newEvents = session.eventBuffer.slice(startIdx);
          for (const event of newEvents) {
            cursor++;
            await stream.writeSSE({
              id: String(cursor),
              data: JSON.stringify(event)
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
  app.post("/kill", async (c) => {
    const sessionId = getSessionId(c);
    const killed = sessionManager.killSession(sessionId);
    return c.json({ status: killed ? "killed" : "no_session" });
  });
  app.get("/status", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
    return c.json({
      alive: session?.process?.alive ?? false,
      sessionId: session?.process?.sessionId ?? null,
      eventCount: session?.eventCounter ?? 0
    });
  });
  return app;
}
export {
  createAgentRoutes
};
