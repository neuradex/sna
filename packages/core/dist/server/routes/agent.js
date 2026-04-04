import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getProvider
} from "../../core/providers/index.js";
import { logger } from "../../lib/logger.js";
import { getDb } from "../../db/schema.js";
import { buildHistoryFromDb } from "../history-builder.js";
import { httpJson } from "../api-types.js";
import { saveImages } from "../image-store.js";
function getSessionId(c) {
  return c.req.query("session") ?? "default";
}
const DEFAULT_RUN_ONCE_TIMEOUT = 12e4;
async function runOnce(sessionManager, opts) {
  const sessionId = `run-once-${crypto.randomUUID().slice(0, 8)}`;
  const timeout = opts.timeout ?? DEFAULT_RUN_ONCE_TIMEOUT;
  const session = sessionManager.createSession({
    id: sessionId,
    label: "run-once",
    cwd: opts.cwd ?? process.cwd()
  });
  const provider = getProvider(opts.provider ?? "claude-code");
  const extraArgs = opts.extraArgs ? [...opts.extraArgs] : [];
  if (opts.systemPrompt) extraArgs.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) extraArgs.push("--append-system-prompt", opts.appendSystemPrompt);
  const proc = provider.spawn({
    cwd: session.cwd,
    prompt: opts.message,
    model: opts.model ?? "claude-sonnet-4-6",
    permissionMode: opts.permissionMode ?? "bypassPermissions",
    env: { SNA_SESSION_ID: sessionId },
    extraArgs
  });
  sessionManager.setProcess(sessionId, proc);
  try {
    const result = await new Promise((resolve, reject) => {
      const texts = [];
      let usage = null;
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
          usage = e.data ?? null;
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
function createAgentRoutes(sessionManager) {
  const app = new Hono();
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const session = sessionManager.createSession({
        label: body.label,
        cwd: body.cwd,
        meta: body.meta
      });
      logger.log("route", `POST /sessions \u2192 created "${session.id}"`);
      return httpJson(c, "sessions.create", { status: "created", sessionId: session.id, label: session.label, meta: session.meta });
    } catch (e) {
      logger.err("err", `POST /sessions \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 409);
    }
  });
  app.get("/sessions", (c) => {
    return httpJson(c, "sessions.list", { sessions: sessionManager.listSessions() });
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
    return httpJson(c, "sessions.remove", { status: "removed" });
  });
  app.post("/run-once", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.message) {
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    try {
      const result = await runOnce(sessionManager, body);
      return httpJson(c, "agent.run-once", result);
    } catch (e) {
      logger.err("err", `POST /run-once \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/start", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const session = sessionManager.getOrCreateSession(sessionId, {
      cwd: body.cwd
    });
    if (session.process?.alive && !body.force) {
      logger.log("route", `POST /start?session=${sessionId} \u2192 already_running`);
      return httpJson(c, "agent.start", {
        status: "already_running",
        provider: "claude-code",
        sessionId: session.process.sessionId ?? session.id
      });
    }
    if (session.process?.alive) {
      session.process.kill();
    }
    const provider = getProvider(body.provider ?? "claude-code");
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
      if (body.prompt) {
        db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, body.prompt, body.meta ? JSON.stringify(body.meta) : null);
      }
      const skillMatch = body.prompt?.match(/^Execute the skill:\s*(\S+)/);
      if (skillMatch) {
        db.prepare(
          `INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`
        ).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
      }
    } catch {
    }
    const providerName = body.provider ?? "claude-code";
    const model = body.model ?? "claude-sonnet-4-6";
    const permissionMode = body.permissionMode;
    const extraArgs = body.extraArgs;
    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode,
        env: { SNA_SESSION_ID: sessionId },
        history: body.history,
        extraArgs
      });
      sessionManager.setProcess(sessionId, proc);
      sessionManager.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, extraArgs });
      logger.log("route", `POST /start?session=${sessionId} \u2192 started`);
      return httpJson(c, "agent.start", {
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
    if (!body.message && !body.images?.length) {
      logger.err("err", `POST /send?session=${sessionId} \u2192 empty message`);
      return c.json({ status: "error", message: "message or images required" }, 400);
    }
    const textContent = body.message ?? "(image)";
    let meta = body.meta ? { ...body.meta } : {};
    if (body.images?.length) {
      const filenames = saveImages(sessionId, body.images);
      meta.images = filenames;
    }
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
      db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, textContent, Object.keys(meta).length > 0 ? JSON.stringify(meta) : null);
    } catch {
    }
    sessionManager.pushEvent(sessionId, {
      type: "user_message",
      message: textContent,
      data: Object.keys(meta).length > 0 ? meta : void 0,
      timestamp: Date.now()
    });
    sessionManager.updateSessionState(sessionId, "processing");
    sessionManager.touch(sessionId);
    if (body.images?.length) {
      const content = [
        ...body.images.map((img) => ({
          type: "image",
          source: { type: "base64", media_type: img.mimeType, data: img.base64 }
        })),
        ...body.message ? [{ type: "text", text: body.message }] : []
      ];
      logger.log("route", `POST /send?session=${sessionId} \u2192 ${body.images.length} image(s) + "${(body.message ?? "").slice(0, 40)}"`);
      session.process.send(content);
    } else {
      logger.log("route", `POST /send?session=${sessionId} \u2192 "${body.message.slice(0, 80)}"`);
      session.process.send(body.message);
    }
    return httpJson(c, "agent.send", { status: "sent" });
  });
  app.get("/events", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getOrCreateSession(sessionId);
    const sinceParam = c.req.query("since");
    const sinceCursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;
    return streamSSE(c, async (stream) => {
      const KEEPALIVE_MS = 15e3;
      const signal = c.req.raw.signal;
      const queue = [];
      let wakeUp = null;
      const unsub = sessionManager.onSessionEvent(sessionId, (eventCursor, event) => {
        queue.push({ cursor: eventCursor, event });
        const fn = wakeUp;
        wakeUp = null;
        fn?.();
      });
      signal.addEventListener("abort", () => {
        const fn = wakeUp;
        wakeUp = null;
        fn?.();
      });
      try {
        let cursor = sinceCursor;
        if (cursor < session.eventCounter) {
          const startIdx = Math.max(
            0,
            session.eventBuffer.length - (session.eventCounter - cursor)
          );
          for (const event of session.eventBuffer.slice(startIdx)) {
            cursor++;
            await stream.writeSSE({ id: String(cursor), data: JSON.stringify(event) });
          }
        } else {
          cursor = session.eventCounter;
        }
        while (queue.length > 0 && queue[0].cursor !== -1 && queue[0].cursor <= cursor) queue.shift();
        while (!signal.aborted) {
          if (queue.length === 0) {
            await Promise.race([
              new Promise((r) => {
                wakeUp = r;
              }),
              new Promise((r) => setTimeout(r, KEEPALIVE_MS))
            ]);
          }
          if (signal.aborted) break;
          if (queue.length > 0) {
            while (queue.length > 0) {
              const item = queue.shift();
              if (item.cursor === -1) {
                await stream.writeSSE({ data: JSON.stringify(item.event) });
              } else {
                await stream.writeSSE({ id: String(item.cursor), data: JSON.stringify(item.event) });
              }
            }
          } else {
            await stream.writeSSE({ data: "" });
          }
        }
      } finally {
        unsub();
      }
    });
  });
  app.post("/restart", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    try {
      const ccSessionId = sessionManager.getSession(sessionId)?.ccSessionId;
      const { config } = sessionManager.restartSession(sessionId, body, (cfg) => {
        const prov = getProvider(cfg.provider);
        const resumeArgs = ccSessionId ? ["--resume", ccSessionId] : ["--resume"];
        return prov.spawn({
          cwd: sessionManager.getSession(sessionId).cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          env: { SNA_SESSION_ID: sessionId },
          extraArgs: [...cfg.extraArgs ?? [], ...resumeArgs]
        });
      });
      logger.log("route", `POST /restart?session=${sessionId} \u2192 restarted`);
      return httpJson(c, "agent.restart", {
        status: "restarted",
        provider: config.provider,
        sessionId
      });
    } catch (e) {
      logger.err("err", `POST /restart?session=${sessionId} \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/resume", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const session = sessionManager.getOrCreateSession(sessionId);
    if (session.process?.alive) {
      return c.json({ status: "error", message: "Session already running. Use agent.send instead." }, 400);
    }
    const history = buildHistoryFromDb(sessionId);
    if (history.length === 0 && !body.prompt) {
      return c.json({ status: "error", message: "No history in DB \u2014 nothing to resume." }, 400);
    }
    const providerName = body.provider ?? "claude-code";
    const model = body.model ?? session.lastStartConfig?.model ?? "claude-sonnet-4-6";
    const permissionMode = body.permissionMode ?? session.lastStartConfig?.permissionMode;
    const extraArgs = body.extraArgs ?? session.lastStartConfig?.extraArgs;
    const provider = getProvider(providerName);
    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode,
        env: { SNA_SESSION_ID: sessionId },
        history: history.length > 0 ? history : void 0,
        extraArgs
      });
      sessionManager.setProcess(sessionId, proc, "resumed");
      sessionManager.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, extraArgs });
      logger.log("route", `POST /resume?session=${sessionId} \u2192 resumed (${history.length} history msgs)`);
      return httpJson(c, "agent.resume", {
        status: "resumed",
        provider: providerName,
        sessionId: session.id,
        historyCount: history.length
      });
    } catch (e) {
      logger.err("err", `POST /resume?session=${sessionId} \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/interrupt", async (c) => {
    const sessionId = getSessionId(c);
    const interrupted = sessionManager.interruptSession(sessionId);
    return httpJson(c, "agent.interrupt", { status: interrupted ? "interrupted" : "no_session" });
  });
  app.post("/set-model", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    if (!body.model) return c.json({ status: "error", message: "model is required" }, 400);
    const updated = sessionManager.setSessionModel(sessionId, body.model);
    return httpJson(c, "agent.set-model", { status: updated ? "updated" : "no_session", model: body.model });
  });
  app.post("/set-permission-mode", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    if (!body.permissionMode) return c.json({ status: "error", message: "permissionMode is required" }, 400);
    const updated = sessionManager.setSessionPermissionMode(sessionId, body.permissionMode);
    return httpJson(c, "agent.set-permission-mode", { status: updated ? "updated" : "no_session", permissionMode: body.permissionMode });
  });
  app.post("/kill", async (c) => {
    const sessionId = getSessionId(c);
    const killed = sessionManager.killSession(sessionId);
    return httpJson(c, "agent.kill", { status: killed ? "killed" : "no_session" });
  });
  app.get("/status", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
    const alive = session?.process?.alive ?? false;
    let messageCount = 0;
    let lastMessage = null;
    try {
      const db = getDb();
      const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId);
      messageCount = count?.c ?? 0;
      const last = db.prepare("SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId);
      if (last) lastMessage = { role: last.role, content: last.content, created_at: last.created_at };
    } catch {
    }
    return httpJson(c, "agent.status", {
      alive,
      agentStatus: !alive ? "disconnected" : session?.state === "processing" ? "busy" : "idle",
      sessionId: session?.process?.sessionId ?? null,
      ccSessionId: session?.ccSessionId ?? null,
      eventCount: session?.eventCounter ?? 0,
      messageCount,
      lastMessage,
      config: session?.lastStartConfig ?? null
    });
  });
  app.post("/permission-request", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    logger.log("route", `POST /permission-request?session=${sessionId} \u2192 ${body.tool_name}`);
    const result = await sessionManager.createPendingPermission(sessionId, body);
    return c.json({ approved: result });
  });
  app.post("/permission-respond", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const approved = body.approved ?? false;
    const resolved = sessionManager.resolvePendingPermission(sessionId, approved);
    if (!resolved) {
      return c.json({ status: "error", message: "No pending permission request" }, 404);
    }
    logger.log("route", `POST /permission-respond?session=${sessionId} \u2192 ${approved ? "approved" : "denied"}`);
    return httpJson(c, "permission.respond", { status: approved ? "approved" : "denied" });
  });
  app.get("/permission-pending", (c) => {
    const sessionId = c.req.query("session");
    if (sessionId) {
      const pending = sessionManager.getPendingPermission(sessionId);
      return httpJson(c, "permission.pending", { pending: pending ? [{ sessionId, ...pending }] : [] });
    }
    return httpJson(c, "permission.pending", { pending: sessionManager.getAllPendingPermissions() });
  });
  return app;
}
export {
  createAgentRoutes,
  runOnce
};
