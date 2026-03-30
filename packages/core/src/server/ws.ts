/**
 * WebSocket API — wraps all SNA HTTP functionality over a single WS connection.
 *
 * Connect to `ws://host:port/ws` and exchange JSON messages.
 *
 * Protocol:
 *   Client → Server:  { type: "sessions.list", rid?: "1" }
 *   Server → Client:  { type: "sessions.list", rid: "1", sessions: [...] }
 *   Server → Client:  { type: "error", rid: "1", message: "..." }
 *   Server → Client:  { type: "agent.event", session: "abc", cursor: 42, event: {...} }  (push)
 *   Server → Client:  { type: "skill.event", data: {...} }  (push)
 *
 * Message types:
 *   sessions.create   { label?, cwd?, meta? }
 *   sessions.list     {}
 *   sessions.remove   { session }
 *
 *   agent.start       { session?, provider?, prompt?, model?, permissionMode?, force?, meta?, extraArgs? }
 *   agent.send        { session?, message, meta? }
 *   agent.kill        { session? }
 *   agent.status      { session? }
 *   agent.subscribe   { session?, since? }
 *   agent.unsubscribe { session? }
 *   agent.run-once    { message, model?, systemPrompt?, permissionMode?, timeout? }
 *
 *   events.subscribe  { since? }
 *   events.unsubscribe {}
 *   emit              { skill, eventType, message, data?, session? }
 *
 *   permission.respond { session?, approved }
 *   permission.pending { session? }
 *
 *   chat.sessions.list    {}
 *   chat.sessions.create  { id?, label?, chatType?, meta? }
 *   chat.sessions.remove  { session }
 *   chat.messages.list    { session, since? }
 *   chat.messages.create  { session, role, content?, skill_name?, meta? }
 *   chat.messages.clear   { session }
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { AgentEvent } from "../core/providers/types.js";
import { getProvider } from "../core/providers/index.js";
import { getDb } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { runOnce, type RunOnceOptions } from "./routes/agent.js";
import type { SessionManager } from "./session-manager.js";

// ── Types ─────────────────────────────────────────────────────────

interface WsRequest {
  type: string;
  rid?: string;
  [key: string]: unknown;
}

interface ConnState {
  agentUnsubs: Map<string, () => void>;
  skillPollTimer: ReturnType<typeof setInterval> | null;
}

// ── Helpers ───────────────────────────────────────────────────────

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function reply(ws: WebSocket, msg: WsRequest, data: Record<string, unknown>): void {
  send(ws, { ...data, type: msg.type, ...(msg.rid != null ? { rid: msg.rid } : {}) });
}

function replyError(ws: WebSocket, msg: WsRequest, message: string): void {
  send(ws, { type: "error", ...(msg.rid != null ? { rid: msg.rid } : {}), message });
}

// ── Attach ────────────────────────────────────────────────────────

/**
 * Attach a WebSocket server to an existing HTTP server.
 * Handles upgrade requests on the `/ws` path.
 */
export function attachWebSocket(
  server: HttpServer,
  sessionManager: SessionManager,
): WebSocketServer {
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
    const state: ConnState = { agentUnsubs: new Map(), skillPollTimer: null };

    ws.on("message", (raw) => {
      let msg: WsRequest;
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
      if (state.skillPollTimer) {
        clearInterval(state.skillPollTimer);
        state.skillPollTimer = null;
      }
    });
  });

  return wss;
}

// ── Message router ────────────────────────────────────────────────

function handleMessage(
  ws: WebSocket,
  msg: WsRequest,
  sm: SessionManager,
  state: ConnState,
): void {
  switch (msg.type) {
    // ── Session CRUD ──────────────────────────────────
    case "sessions.create":
      return handleSessionsCreate(ws, msg, sm);
    case "sessions.list":
      return reply(ws, msg, { sessions: sm.listSessions() });
    case "sessions.remove":
      return handleSessionsRemove(ws, msg, sm);

    // ── Agent lifecycle ───────────────────────────────
    case "agent.start":
      return handleAgentStart(ws, msg, sm);
    case "agent.send":
      return handleAgentSend(ws, msg, sm);
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
      return handleEventsSubscribe(ws, msg, state);
    case "events.unsubscribe":
      return handleEventsUnsubscribe(ws, msg, state);
    case "emit":
      return handleEmit(ws, msg);

    // ── Permission ────────────────────────────────────
    case "permission.respond":
      return handlePermissionRespond(ws, msg, sm);
    case "permission.pending":
      return handlePermissionPending(ws, msg, sm);

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

// ── Session handlers ──────────────────────────────────────────────

function handleSessionsCreate(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  try {
    const session = sm.createSession({
      label: msg.label as string | undefined,
      cwd: msg.cwd as string | undefined,
      meta: msg.meta as Record<string, unknown> | undefined,
    });
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, 'main', ?)`)
        .run(session.id, session.label, session.meta ? JSON.stringify(session.meta) : null);
    } catch { /* non-fatal */ }
    reply(ws, msg, { sessionId: session.id, label: session.label, meta: session.meta });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleSessionsRemove(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const id = msg.session as string;
  if (!id) return replyError(ws, msg, "session is required");
  if (id === "default") return replyError(ws, msg, "Cannot remove default session");
  const removed = sm.removeSession(id);
  if (!removed) return replyError(ws, msg, "Session not found");
  reply(ws, msg, {});
}

// ── Agent handlers ────────────────────────────────────────────────

function handleAgentStart(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const session = sm.getOrCreateSession(sessionId);

  if (session.process?.alive && !msg.force) {
    reply(ws, msg, { status: "already_running", provider: "claude-code", sessionId: session.id });
    return;
  }

  if (session.process?.alive) session.process.kill();
  session.eventBuffer.length = 0;

  const provider = getProvider((msg.provider as string) ?? "claude-code");

  // Persist
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
      .run(sessionId, session.label ?? sessionId);
    if (msg.prompt) {
      db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`)
        .run(sessionId, msg.prompt as string, msg.meta ? JSON.stringify(msg.meta) : null);
    }
    const skillMatch = (msg.prompt as string)?.match(/^Execute the skill:\s*(\S+)/);
    if (skillMatch) {
      db.prepare(`INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`)
        .run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
    }
  } catch { /* non-fatal */ }

  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt as string | undefined,
      model: (msg.model as string) ?? "claude-sonnet-4-6",
      permissionMode: (msg.permissionMode as any) ?? "acceptEdits",
      env: { SNA_SESSION_ID: sessionId },
      extraArgs: msg.extraArgs as string[] | undefined,
    });
    sm.setProcess(sessionId, proc);
    reply(ws, msg, { status: "started", provider: provider.name, sessionId: session.id });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleAgentSend(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const session = sm.getSession(sessionId);

  if (!session?.process?.alive) {
    return replyError(ws, msg, `No active agent session "${sessionId}". Start first.`);
  }
  if (!msg.message) {
    return replyError(ws, msg, "message is required");
  }

  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
      .run(sessionId, session.label ?? sessionId);
    db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`)
      .run(sessionId, msg.message as string, msg.meta ? JSON.stringify(msg.meta) : null);
  } catch { /* non-fatal */ }

  session.state = "processing";
  sm.touch(sessionId);
  session.process.send(msg.message as string);
  reply(ws, msg, {});
}

function handleAgentKill(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const killed = sm.killSession(sessionId);
  reply(ws, msg, { status: killed ? "killed" : "no_session" });
}

function handleAgentStatus(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const session = sm.getSession(sessionId);
  reply(ws, msg, {
    alive: session?.process?.alive ?? false,
    sessionId: session?.process?.sessionId ?? null,
    eventCount: session?.eventCounter ?? 0,
  });
}

async function handleAgentRunOnce(ws: WebSocket, msg: WsRequest, sm: SessionManager): Promise<void> {
  if (!msg.message) return replyError(ws, msg, "message is required");
  try {
    const { result, usage } = await runOnce(sm, msg as unknown as RunOnceOptions);
    reply(ws, msg, { result, usage });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

// ── Agent event subscription handlers ─────────────────────────────

function handleAgentSubscribe(
  ws: WebSocket,
  msg: WsRequest,
  sm: SessionManager,
  state: ConnState,
): void {
  const sessionId = (msg.session as string) ?? "default";
  const session = sm.getOrCreateSession(sessionId);

  // Unsubscribe existing for this session
  state.agentUnsubs.get(sessionId)?.();

  // Replay buffered events from cursor
  let cursor = typeof msg.since === "number" ? msg.since : session.eventCounter;
  if (cursor < session.eventCounter) {
    const startIdx = Math.max(0, session.eventBuffer.length - (session.eventCounter - cursor));
    const events = session.eventBuffer.slice(startIdx);
    for (const event of events) {
      cursor++;
      send(ws, { type: "agent.event", session: sessionId, cursor, event });
    }
  }

  // Subscribe to future events — pushed instantly, no polling
  const unsub = sm.onSessionEvent(sessionId, (eventCursor, event) => {
    send(ws, { type: "agent.event", session: sessionId, cursor: eventCursor, event });
  });
  state.agentUnsubs.set(sessionId, unsub);

  reply(ws, msg, { cursor });
}

function handleAgentUnsubscribe(ws: WebSocket, msg: WsRequest, state: ConnState): void {
  const sessionId = (msg.session as string) ?? "default";
  state.agentUnsubs.get(sessionId)?.();
  state.agentUnsubs.delete(sessionId);
  reply(ws, msg, {});
}

// ── Skill event handlers ──────────────────────────────────────────

const SKILL_POLL_MS = 500;

function handleEventsSubscribe(ws: WebSocket, msg: WsRequest, state: ConnState): void {
  if (state.skillPollTimer) {
    clearInterval(state.skillPollTimer);
    state.skillPollTimer = null;
  }

  let lastId = typeof msg.since === "number" ? msg.since : -1;
  if (lastId <= 0) {
    try {
      const db = getDb();
      const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get() as { maxId: number | null };
      lastId = row.maxId ?? 0;
    } catch {
      lastId = 0;
    }
  }

  state.skillPollTimer = setInterval(() => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, session_id, skill, type, message, data, created_at
         FROM skill_events WHERE id > ? ORDER BY id ASC LIMIT 50`,
      ).all(lastId) as any[];
      for (const row of rows) {
        send(ws, { type: "skill.event", data: row });
        lastId = row.id;
      }
    } catch { /* DB not ready */ }
  }, SKILL_POLL_MS);

  reply(ws, msg, { lastId });
}

function handleEventsUnsubscribe(ws: WebSocket, msg: WsRequest, state: ConnState): void {
  if (state.skillPollTimer) {
    clearInterval(state.skillPollTimer);
    state.skillPollTimer = null;
  }
  reply(ws, msg, {});
}

function handleEmit(ws: WebSocket, msg: WsRequest): void {
  const skill = msg.skill as string;
  const eventType = msg.eventType as string;
  const emitMessage = msg.message as string;
  const data = msg.data as string | undefined;
  const sessionId = msg.session as string | undefined;

  if (!skill || !eventType || !emitMessage) {
    return replyError(ws, msg, "skill, eventType, message are required");
  }

  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO skill_events (session_id, skill, type, message, data) VALUES (?, ?, ?, ?, ?)`,
    ).run(sessionId ?? null, skill, eventType, emitMessage, data ?? null);
    reply(ws, msg, { id: Number(result.lastInsertRowid) });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

// ── Permission handlers ───────────────────────────────────────────

function handlePermissionRespond(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const approved = msg.approved === true;
  const resolved = sm.resolvePendingPermission(sessionId, approved);
  if (!resolved) return replyError(ws, msg, "No pending permission request");
  reply(ws, msg, { status: approved ? "approved" : "denied" });
}

function handlePermissionPending(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = msg.session as string | undefined;
  if (sessionId) {
    const pending = sm.getPendingPermission(sessionId);
    reply(ws, msg, { pending: pending ? { sessionId, ...pending } : null });
  } else {
    reply(ws, msg, { pending: sm.getAllPendingPermissions() });
  }
}

// ── Chat session handlers ─────────────────────────────────────────

function handleChatSessionsList(ws: WebSocket, msg: WsRequest): void {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, label, type, meta, created_at FROM chat_sessions ORDER BY created_at DESC`,
    ).all() as { id: string; label: string; type: string; meta: string | null; created_at: string }[];
    const sessions = rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
    reply(ws, msg, { sessions });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleChatSessionsCreate(ws: WebSocket, msg: WsRequest): void {
  const id = (msg.id as string) ?? crypto.randomUUID().slice(0, 8);
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`)
      .run(id, (msg.label as string) ?? id, (msg.chatType as string) ?? "background", msg.meta ? JSON.stringify(msg.meta) : null);
    reply(ws, msg, { id, meta: (msg.meta as Record<string, unknown>) ?? null });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleChatSessionsRemove(ws: WebSocket, msg: WsRequest): void {
  const id = msg.session as string;
  if (!id) return replyError(ws, msg, "session is required");
  if (id === "default") return replyError(ws, msg, "Cannot delete default session");
  try {
    const db = getDb();
    db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
    reply(ws, msg, {});
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

// ── Chat message handlers ─────────────────────────────────────────

function handleChatMessagesList(ws: WebSocket, msg: WsRequest): void {
  const id = msg.session as string;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    const db = getDb();
    const query = msg.since != null
      ? db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`)
      : db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`);
    const messages = msg.since != null ? query.all(id, msg.since as number) : query.all(id);
    reply(ws, msg, { messages });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleChatMessagesCreate(ws: WebSocket, msg: WsRequest): void {
  const sessionId = msg.session as string;
  if (!sessionId) return replyError(ws, msg, "session is required");
  if (!msg.role) return replyError(ws, msg, "role is required");
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
      .run(sessionId, sessionId);
    const result = db.prepare(
      `INSERT INTO chat_messages (session_id, role, content, skill_name, meta) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      msg.role as string,
      (msg.content as string) ?? "",
      (msg.skill_name as string) ?? null,
      msg.meta ? JSON.stringify(msg.meta) : null,
    );
    reply(ws, msg, { id: Number(result.lastInsertRowid) });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleChatMessagesClear(ws: WebSocket, msg: WsRequest): void {
  const id = msg.session as string;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    const db = getDb();
    db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
    reply(ws, msg, {});
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}
