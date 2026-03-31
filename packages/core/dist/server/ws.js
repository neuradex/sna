import { WebSocketServer } from "ws";
import { getProvider } from "../core/providers/index.js";
import { getDb } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { runOnce } from "./routes/agent.js";
import { wsReply } from "./api-types.js";
function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
function reply(ws, msg, data) {
  send(ws, { ...data, type: msg.type, ...msg.rid != null ? { rid: msg.rid } : {} });
}
function replyError(ws, msg, message) {
  send(ws, { type: "error", ...msg.rid != null ? { rid: msg.rid } : {}, message });
}
function attachWebSocket(server, sessionManager) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });
  wss.on("connection", (ws) => {
    logger.log("ws", "client connected");
    const state = { agentUnsubs: /* @__PURE__ */ new Map(), skillEventUnsub: null, skillPollTimer: null, permissionUnsub: null, lifecycleUnsub: null };
    state.lifecycleUnsub = sessionManager.onSessionLifecycle((event) => {
      send(ws, { type: "session.lifecycle", ...event });
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", message: "invalid JSON" });
        return;
      }
      if (!msg.type) {
        send(ws, { type: "error", message: "type is required" });
        return;
      }
      handleMessage(ws, msg, sessionManager, state);
    });
    ws.on("close", () => {
      logger.log("ws", "client disconnected");
      for (const unsub of state.agentUnsubs.values()) unsub();
      state.agentUnsubs.clear();
      state.skillEventUnsub?.();
      state.skillEventUnsub = null;
      if (state.skillPollTimer) {
        clearInterval(state.skillPollTimer);
        state.skillPollTimer = null;
      }
      state.permissionUnsub?.();
      state.permissionUnsub = null;
      state.lifecycleUnsub?.();
      state.lifecycleUnsub = null;
    });
  });
  return wss;
}
function handleMessage(ws, msg, sm, state) {
  switch (msg.type) {
    // ── Session CRUD ──────────────────────────────────
    case "sessions.create":
      return handleSessionsCreate(ws, msg, sm);
    case "sessions.list":
      return wsReply(ws, msg, { sessions: sm.listSessions() });
    case "sessions.remove":
      return handleSessionsRemove(ws, msg, sm);
    // ── Agent lifecycle ───────────────────────────────
    case "agent.start":
      return handleAgentStart(ws, msg, sm);
    case "agent.send":
      return handleAgentSend(ws, msg, sm);
    case "agent.restart":
      return handleAgentRestart(ws, msg, sm);
    case "agent.interrupt":
      return handleAgentInterrupt(ws, msg, sm);
    case "agent.set-model":
      return handleAgentSetModel(ws, msg, sm);
    case "agent.set-permission-mode":
      return handleAgentSetPermissionMode(ws, msg, sm);
    case "agent.kill":
      return handleAgentKill(ws, msg, sm);
    case "agent.status":
      return handleAgentStatus(ws, msg, sm);
    case "agent.run-once":
      handleAgentRunOnce(ws, msg, sm);
      return;
    // ── Agent event subscription ──────────────────────
    case "agent.subscribe":
      return handleAgentSubscribe(ws, msg, sm, state);
    case "agent.unsubscribe":
      return handleAgentUnsubscribe(ws, msg, state);
    // ── Skill events ──────────────────────────────────
    case "events.subscribe":
      return handleEventsSubscribe(ws, msg, sm, state);
    case "events.unsubscribe":
      return handleEventsUnsubscribe(ws, msg, state);
    case "emit":
      return handleEmit(ws, msg, sm);
    // ── Permission ────────────────────────────────────
    case "permission.respond":
      return handlePermissionRespond(ws, msg, sm);
    case "permission.pending":
      return handlePermissionPending(ws, msg, sm);
    case "permission.subscribe":
      return handlePermissionSubscribe(ws, msg, sm, state);
    case "permission.unsubscribe":
      return handlePermissionUnsubscribe(ws, msg, state);
    // ── Chat sessions ─────────────────────────────────
    case "chat.sessions.list":
      return handleChatSessionsList(ws, msg);
    case "chat.sessions.create":
      return handleChatSessionsCreate(ws, msg);
    case "chat.sessions.remove":
      return handleChatSessionsRemove(ws, msg);
    // ── Chat messages ─────────────────────────────────
    case "chat.messages.list":
      return handleChatMessagesList(ws, msg);
    case "chat.messages.create":
      return handleChatMessagesCreate(ws, msg);
    case "chat.messages.clear":
      return handleChatMessagesClear(ws, msg);
    default:
      replyError(ws, msg, `Unknown message type: ${msg.type}`);
  }
}
function handleSessionsCreate(ws, msg, sm) {
  try {
    const session = sm.createSession({
      label: msg.label,
      cwd: msg.cwd,
      meta: msg.meta
    });
    wsReply(ws, msg, { status: "created", sessionId: session.id, label: session.label, meta: session.meta });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleSessionsRemove(ws, msg, sm) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  if (id === "default") return replyError(ws, msg, "Cannot remove default session");
  const removed = sm.removeSession(id);
  if (!removed) return replyError(ws, msg, "Session not found");
  wsReply(ws, msg, { status: "removed" });
}
function handleAgentStart(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const session = sm.getOrCreateSession(sessionId, {
    cwd: msg.cwd
  });
  if (session.process?.alive && !msg.force) {
    wsReply(ws, msg, { status: "already_running", provider: "claude-code", sessionId: session.id });
    return;
  }
  if (session.process?.alive) session.process.kill();
  session.eventBuffer.length = 0;
  const provider = getProvider(msg.provider ?? "claude-code");
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
    if (msg.prompt) {
      db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, msg.prompt, msg.meta ? JSON.stringify(msg.meta) : null);
    }
    const skillMatch = msg.prompt?.match(/^Execute the skill:\s*(\S+)/);
    if (skillMatch) {
      db.prepare(`INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
    }
  } catch {
  }
  const providerName = msg.provider ?? "claude-code";
  const model = msg.model ?? "claude-sonnet-4-6";
  const permissionMode = msg.permissionMode ?? "acceptEdits";
  const extraArgs = msg.extraArgs;
  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt,
      model,
      permissionMode,
      env: { SNA_SESSION_ID: sessionId },
      extraArgs
    });
    sm.setProcess(sessionId, proc);
    sm.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, extraArgs });
    wsReply(ws, msg, { status: "started", provider: provider.name, sessionId: session.id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentSend(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const session = sm.getSession(sessionId);
  if (!session?.process?.alive) {
    return replyError(ws, msg, `No active agent session "${sessionId}". Start first.`);
  }
  if (!msg.message) {
    return replyError(ws, msg, "message is required");
  }
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
    db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, msg.message, msg.meta ? JSON.stringify(msg.meta) : null);
  } catch {
  }
  session.state = "processing";
  sm.touch(sessionId);
  session.process.send(msg.message);
  wsReply(ws, msg, { status: "sent" });
}
function handleAgentRestart(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  try {
    const ccSessionId = sm.getSession(sessionId)?.ccSessionId;
    const { config } = sm.restartSession(
      sessionId,
      {
        provider: msg.provider,
        model: msg.model,
        permissionMode: msg.permissionMode,
        extraArgs: msg.extraArgs
      },
      (cfg) => {
        const prov = getProvider(cfg.provider);
        const resumeArgs = ccSessionId ? ["--resume", ccSessionId] : ["--resume"];
        return prov.spawn({
          cwd: sm.getSession(sessionId).cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          env: { SNA_SESSION_ID: sessionId },
          extraArgs: [...cfg.extraArgs ?? [], ...resumeArgs]
        });
      }
    );
    wsReply(ws, msg, { status: "restarted", provider: config.provider, sessionId });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentInterrupt(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const interrupted = sm.interruptSession(sessionId);
  wsReply(ws, msg, { status: interrupted ? "interrupted" : "no_session" });
}
function handleAgentSetModel(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const model = msg.model;
  if (!model) return replyError(ws, msg, "model is required");
  const updated = sm.setSessionModel(sessionId, model);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", model });
}
function handleAgentSetPermissionMode(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const permissionMode = msg.permissionMode;
  if (!permissionMode) return replyError(ws, msg, "permissionMode is required");
  const updated = sm.setSessionPermissionMode(sessionId, permissionMode);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", permissionMode });
}
function handleAgentKill(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const killed = sm.killSession(sessionId);
  wsReply(ws, msg, { status: killed ? "killed" : "no_session" });
}
function handleAgentStatus(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const session = sm.getSession(sessionId);
  wsReply(ws, msg, {
    alive: session?.process?.alive ?? false,
    sessionId: session?.process?.sessionId ?? null,
    eventCount: session?.eventCounter ?? 0
  });
}
async function handleAgentRunOnce(ws, msg, sm) {
  if (!msg.message) return replyError(ws, msg, "message is required");
  try {
    const { result, usage } = await runOnce(sm, msg);
    wsReply(ws, msg, { result, usage });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentSubscribe(ws, msg, sm, state) {
  const sessionId = msg.session ?? "default";
  const session = sm.getOrCreateSession(sessionId);
  state.agentUnsubs.get(sessionId)?.();
  let cursor = typeof msg.since === "number" ? msg.since : session.eventCounter;
  if (cursor < session.eventCounter) {
    const startIdx = Math.max(0, session.eventBuffer.length - (session.eventCounter - cursor));
    const events = session.eventBuffer.slice(startIdx);
    for (const event of events) {
      cursor++;
      send(ws, { type: "agent.event", session: sessionId, cursor, event });
    }
  }
  const unsub = sm.onSessionEvent(sessionId, (eventCursor, event) => {
    send(ws, { type: "agent.event", session: sessionId, cursor: eventCursor, event });
  });
  state.agentUnsubs.set(sessionId, unsub);
  reply(ws, msg, { cursor });
}
function handleAgentUnsubscribe(ws, msg, state) {
  const sessionId = msg.session ?? "default";
  state.agentUnsubs.get(sessionId)?.();
  state.agentUnsubs.delete(sessionId);
  reply(ws, msg, {});
}
const SKILL_POLL_MS = 2e3;
function handleEventsSubscribe(ws, msg, sm, state) {
  state.skillEventUnsub?.();
  state.skillEventUnsub = null;
  if (state.skillPollTimer) {
    clearInterval(state.skillPollTimer);
    state.skillPollTimer = null;
  }
  let lastId = typeof msg.since === "number" ? msg.since : -1;
  if (lastId <= 0) {
    try {
      const db = getDb();
      const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get();
      lastId = row.maxId ?? 0;
    } catch {
      lastId = 0;
    }
  }
  state.skillEventUnsub = sm.onSkillEvent((event) => {
    const eventId = event.id;
    if (eventId > lastId) {
      lastId = eventId;
      send(ws, { type: "skill.event", data: event });
    }
  });
  state.skillPollTimer = setInterval(() => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, session_id, skill, type, message, data, created_at
         FROM skill_events WHERE id > ? ORDER BY id ASC LIMIT 50`
      ).all(lastId);
      for (const row of rows) {
        if (row.id > lastId) {
          lastId = row.id;
          send(ws, { type: "skill.event", data: row });
        }
      }
    } catch {
    }
  }, SKILL_POLL_MS);
  reply(ws, msg, { lastId });
}
function handleEventsUnsubscribe(ws, msg, state) {
  state.skillEventUnsub?.();
  state.skillEventUnsub = null;
  if (state.skillPollTimer) {
    clearInterval(state.skillPollTimer);
    state.skillPollTimer = null;
  }
  reply(ws, msg, {});
}
function handleEmit(ws, msg, sm) {
  const skill = msg.skill;
  const eventType = msg.eventType;
  const emitMessage = msg.message;
  const data = msg.data;
  const sessionId = msg.session;
  if (!skill || !eventType || !emitMessage) {
    return replyError(ws, msg, "skill, eventType, message are required");
  }
  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO skill_events (session_id, skill, type, message, data) VALUES (?, ?, ?, ?, ?)`
    ).run(sessionId ?? null, skill, eventType, emitMessage, data ?? null);
    const id = Number(result.lastInsertRowid);
    sm.broadcastSkillEvent({
      id,
      session_id: sessionId ?? null,
      skill,
      type: eventType,
      message: emitMessage,
      data: data ?? null,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    wsReply(ws, msg, { id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handlePermissionRespond(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const approved = msg.approved === true;
  const resolved = sm.resolvePendingPermission(sessionId, approved);
  if (!resolved) return replyError(ws, msg, "No pending permission request");
  wsReply(ws, msg, { status: approved ? "approved" : "denied" });
}
function handlePermissionPending(ws, msg, sm) {
  const sessionId = msg.session;
  if (sessionId) {
    const pending = sm.getPendingPermission(sessionId);
    wsReply(ws, msg, { pending: pending ? [{ sessionId, ...pending }] : [] });
  } else {
    wsReply(ws, msg, { pending: sm.getAllPendingPermissions() });
  }
}
function handlePermissionSubscribe(ws, msg, sm, state) {
  state.permissionUnsub?.();
  state.permissionUnsub = sm.onPermissionRequest((sessionId, request, createdAt) => {
    send(ws, { type: "permission.request", session: sessionId, request, createdAt });
  });
  reply(ws, msg, {});
}
function handlePermissionUnsubscribe(ws, msg, state) {
  state.permissionUnsub?.();
  state.permissionUnsub = null;
  reply(ws, msg, {});
}
function handleChatSessionsList(ws, msg) {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, label, type, meta, cwd, created_at FROM chat_sessions ORDER BY created_at DESC`
    ).all();
    const sessions = rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
    wsReply(ws, msg, { sessions });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatSessionsCreate(ws, msg) {
  const id = msg.id ?? crypto.randomUUID().slice(0, 8);
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`).run(id, msg.label ?? id, msg.chatType ?? "background", msg.meta ? JSON.stringify(msg.meta) : null);
    wsReply(ws, msg, { status: "created", id, meta: msg.meta ?? null });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatSessionsRemove(ws, msg) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  if (id === "default") return replyError(ws, msg, "Cannot delete default session");
  try {
    const db = getDb();
    db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
    wsReply(ws, msg, { status: "deleted" });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatMessagesList(ws, msg) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    const db = getDb();
    const query = msg.since != null ? db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`) : db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`);
    const messages = msg.since != null ? query.all(id, msg.since) : query.all(id);
    wsReply(ws, msg, { messages });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatMessagesCreate(ws, msg) {
  const sessionId = msg.session;
  if (!sessionId) return replyError(ws, msg, "session is required");
  if (!msg.role) return replyError(ws, msg, "role is required");
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, sessionId);
    const result = db.prepare(
      `INSERT INTO chat_messages (session_id, role, content, skill_name, meta) VALUES (?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      msg.role,
      msg.content ?? "",
      msg.skill_name ?? null,
      msg.meta ? JSON.stringify(msg.meta) : null
    );
    wsReply(ws, msg, { status: "created", id: Number(result.lastInsertRowid) });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatMessagesClear(ws, msg) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    const db = getDb();
    db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
    wsReply(ws, msg, { status: "cleared" });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
export {
  attachWebSocket
};
