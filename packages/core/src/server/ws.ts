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
 *   Server → Client:  { type: "sessions.snapshot", sessions: [...] }                   (auto-push on connect + state change)
 *   Server → Client:  { type: "session.lifecycle", session: "abc", state: "killed" }   (auto-push)
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
 *   agent.run-once    { message, model?, systemPrompt?, appendSystemPrompt?, permissionMode?, cwd?, timeout?, provider?, extraArgs? }
 *   agent.completion  { prompt, model?, label?, systemPrompt?, appendSystemPrompt?, timeout?, extraArgs?, env? }
 *
 *   events.subscribe  { since? }
 *   events.unsubscribe {}
 *   emit              { skill, eventType, message, data?, session? }
 *                     NOTE: WS uses `eventType` (not `type`) because `type` is reserved
 *                     as the WS protocol routing field. HTTP POST /emit uses `type` instead.
 *                     WS uses `session` (not `session_id`) consistent with all other WS ops.
 *
 *   permission.respond   { session?, approved }
 *   permission.pending   { session? }
 *   permission.subscribe {}              → pushes { type: "permission.request", session, request, createdAt }
 *   permission.unsubscribe {}
 *
 *   chat.sessions.list    {}
 *   chat.sessions.create  { id?, label?, chatType?, meta? }
 *                         NOTE: WS uses `chatType` (not `type`) for the same reason as `eventType` above.
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
import { completion, type CompletionOptions } from "../core/completion.js";
import { wsReply } from "./api-types.js";
import { buildCanonicalFromDb } from "../history/canonical.js";
import { saveEmbeds } from "./image-store.js";
import { insertChatMessage } from "../db/chat-messages.js";
import { formatEmbedRef } from "../history/embed-refs.js";
import type { EmbedRecord } from "../history/types.js";
import { getConfig } from "../config.js";
import type { SessionManager } from "./session-manager.js";

// ── Types ─────────────────────────────────────────────────────────

interface WsRequest {
  type: string;
  rid?: string;
  [key: string]: unknown;
}

interface ConnState {
  agentUnsubs: Map<string, () => void>;
  skillEventUnsub: (() => void) | null;
  skillPollTimer: ReturnType<typeof setInterval> | null;
  permissionUnsub: (() => void) | null;
  lifecycleUnsub: (() => void) | null;
  configChangedUnsub: (() => void) | null;
  stateChangedUnsub: (() => void) | null;
  metadataChangedUnsub: (() => void) | null;
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
    const state: ConnState = { agentUnsubs: new Map(), skillEventUnsub: null, skillPollTimer: null, permissionUnsub: null, lifecycleUnsub: null, configChangedUnsub: null, stateChangedUnsub: null, metadataChangedUnsub: null };

    // Helper: push full session snapshot to this client
    const pushSnapshot = () => send(ws, { type: "sessions.snapshot", sessions: sessionManager.listSessions() });

    // 1. Push snapshot immediately on connection
    pushSnapshot();

    // 2. Push snapshot on session lifecycle changes (started/killed/exited/crashed)
    state.lifecycleUnsub = sessionManager.onSessionLifecycle((event) => {
      send(ws, { type: "session.lifecycle", ...event });
      pushSnapshot();
    });

    // Auto-push config changes to all clients (no subscribe needed)
    state.configChangedUnsub = sessionManager.onConfigChanged((event) => {
      send(ws, { type: "session.config-changed", ...event });
    });

    // 3. Push snapshot on agent status changes (idle/busy/disconnected)
    state.stateChangedUnsub = sessionManager.onStateChanged((event) => {
      send(ws, { type: "session.state-changed", ...event });
      pushSnapshot();
    });

    // 4. Push snapshot on session metadata changes (label/meta/cwd)
    state.metadataChangedUnsub = sessionManager.onMetadataChanged(() => {
      pushSnapshot();
    });

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
      state.configChangedUnsub?.();
      state.configChangedUnsub = null;
      state.stateChangedUnsub?.();
      state.stateChangedUnsub = null;
      state.metadataChangedUnsub?.();
      state.metadataChangedUnsub = null;
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
      return wsReply(ws, msg, { sessions: sm.listSessions() });
    case "sessions.update":
      return handleSessionsUpdate(ws, msg, sm);
    case "sessions.remove":
      return handleSessionsRemove(ws, msg, sm);

    // ── Agent lifecycle ───────────────────────────────
    case "agent.start":
      return handleAgentStart(ws, msg, sm);
    case "agent.send":
      return handleAgentSend(ws, msg, sm);
    case "agent.resume":
      return handleAgentResume(ws, msg, sm);
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
    case "agent.completion":
      handleAgentCompletion(ws, msg);
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

// ── Session handlers ──────────────────────────────────────────────

function handleSessionsCreate(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  try {
    const session = sm.createSession({
      id: msg.id as string | undefined,
      label: msg.label as string | undefined,
      cwd: msg.cwd as string | undefined,
      meta: msg.meta as Record<string, unknown> | undefined,
    });
    wsReply(ws, msg, { status: "created", sessionId: session.id, label: session.label, meta: session.meta });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleSessionsUpdate(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const id = msg.session as string;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    sm.updateSession(id, {
      label: msg.label as string | undefined,
      meta: msg.meta as Record<string, unknown> | undefined,
      cwd: msg.cwd as string | undefined,
    });
    wsReply(ws, msg, { status: "updated", session: id });
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
  wsReply(ws, msg, { status: "removed" });
}

// ── Agent handlers ────────────────────────────────────────────────

function handleAgentStart(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const session = sm.getOrCreateSession(sessionId, {
    cwd: msg.cwd as string | undefined,
  });

  if (session.process?.alive && !msg.force) {
    wsReply(ws, msg, { status: "already_running", provider: getConfig().defaultProvider, sessionId: session.id });
    return;
  }

  if (session.process?.alive) session.process.kill();

  const provider = getProvider((msg.provider as string) ?? getConfig().defaultProvider);

  // Persist
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
      .run(sessionId, session.label ?? sessionId);
    if (msg.prompt) {
      insertChatMessage(db, {
        sessionId, actor: "user", kind: "text",
        content: msg.prompt as string,
        meta: msg.meta as Record<string, unknown> | undefined,
      });
    }
    const skillMatch = (msg.prompt as string)?.match(/^Execute the skill:\s*(\S+)/);
    if (skillMatch) {
      db.prepare(`INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`)
        .run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
    }
  } catch { /* non-fatal */ }

  const cfg = getConfig();
  const providerName = (msg.provider as string) ?? cfg.defaultProvider;
  const model = (msg.model as string) ?? cfg.model;
  const permissionMode = msg.permissionMode as string | undefined;
  const configDir = msg.configDir as string | undefined;
  const extraArgs = msg.extraArgs as string[] | undefined;
  const providerOptions = msg.providerOptions as Record<string, unknown> | undefined;
  const modelProvider = msg.modelProvider as string | undefined;

  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt as string | undefined,
      model,
      permissionMode: permissionMode as any,
      configDir,
      env: { ...(msg.env as Record<string, string>), SNA_SESSION_ID: sessionId },
      history: msg.history as any[] | undefined,
      extraArgs,
      providerOptions,
      systemPrompt: msg.systemPrompt as string | undefined,
      appendSystemPrompt: msg.appendSystemPrompt as string | undefined,
      allowedTools: msg.allowedTools as string[] | undefined,
      disallowedTools: msg.disallowedTools as string[] | undefined,
      mcpServers: msg.mcpServers as any,
    });
    sm.setProcess(sessionId, proc);
    sm.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode, configDir, extraArgs, providerOptions });
    wsReply(ws, msg, { status: "started", provider: provider.name, sessionId: session.id });
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
  const images = msg.images as Array<{ base64: string; mimeType: string }> | undefined;
  if (!msg.message && !images?.length) {
    return replyError(ws, msg, "message or images required");
  }

  const userText = (msg.message as string) ?? "";
  const meta: Record<string, unknown> = msg.meta ? { ...(msg.meta as Record<string, unknown>) } : {};
  const embeds: Record<string, EmbedRecord> = {};
  let contentText = userText;
  if (images?.length) {
    const saved = saveEmbeds(sessionId, images);
    const refs = saved.map(({ id, record }) => {
      embeds[id] = record;
      return formatEmbedRef(id);
    });
    // Append refs after the user's text (or alone if there was no text).
    contentText = userText ? `${userText}\n${refs.join(" ")}` : refs.join(" ");
  }
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
      .run(sessionId, session.label ?? sessionId);
    insertChatMessage(db, {
      sessionId,
      actor: "user",
      kind: "text",
      content: contentText,
      embeds: Object.keys(embeds).length > 0 ? embeds : undefined,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    });
  } catch { /* non-fatal */ }

  // Broadcast user message to agent.subscribe listeners (multi-client sync)
  sm.pushEvent(sessionId, {
    type: "user_message",
    message: contentText,
    data: Object.keys(meta).length > 0 ? meta : undefined,
    timestamp: Date.now(),
  });

  sm.updateSessionState(sessionId, "processing");
  sm.touch(sessionId);

  if (images?.length) {
    const content: import("../core/providers/types.js").ContentBlock[] = [
      ...images.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
      })),
      ...(msg.message ? [{ type: "text" as const, text: msg.message as string }] : []),
    ];
    session.process.send(content);
  } else {
    session.process.send(msg.message as string);
  }
  wsReply(ws, msg, { status: "sent" });
}

function handleAgentResume(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const session = sm.getOrCreateSession(sessionId);

  if (session.process?.alive) {
    return replyError(ws, msg, "Session already running. Use agent.send instead.");
  }

  const history = buildCanonicalFromDb(sessionId);
  if (history.length === 0 && !msg.prompt) {
    return replyError(ws, msg, "No history in DB — nothing to resume.");
  }

  const providerName = (msg.provider as string) ?? session.lastStartConfig?.provider ?? getConfig().defaultProvider;
  const providerChanged = session.lastStartConfig && session.lastStartConfig.provider !== providerName;
  const model = (msg.model as string) ?? session.lastStartConfig?.model ?? getConfig().model;
  const permissionMode = (msg.permissionMode as string) ?? session.lastStartConfig?.permissionMode;
  const configDir = providerChanged ? (msg.configDir as string | undefined) : ((msg.configDir as string) ?? session.lastStartConfig?.configDir);
  // Provider-specific fields: inherit only when provider is unchanged.
  const extraArgs = providerChanged ? (msg.extraArgs as string[] | undefined) : ((msg.extraArgs as string[]) ?? session.lastStartConfig?.extraArgs);
  const providerOptions = providerChanged
    ? (msg.providerOptions as Record<string, unknown> | undefined)
    : ((msg.providerOptions as Record<string, unknown> | undefined) ?? session.lastStartConfig?.providerOptions);
  const modelProvider = (msg.modelProvider as string | undefined)
    ?? (providerChanged ? undefined : session.lastStartConfig?.modelProvider);
  const provider = getProvider(providerName);

  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt as string | undefined,
      model,
      permissionMode: permissionMode as any,
      configDir,
      env: { ...(msg.env as Record<string, string>), SNA_SESSION_ID: sessionId },
      history: history.length > 0 ? history : undefined,
      extraArgs,
      providerOptions,
      systemPrompt: msg.systemPrompt as string | undefined,
      appendSystemPrompt: msg.appendSystemPrompt as string | undefined,
      allowedTools: msg.allowedTools as string[] | undefined,
      disallowedTools: msg.disallowedTools as string[] | undefined,
      mcpServers: msg.mcpServers as any,
    });
    sm.setProcess(sessionId, proc, "resumed");
    sm.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode, configDir, extraArgs, providerOptions });
    wsReply(ws, msg, {
      status: "resumed",
      provider: providerName,
      sessionId: session.id,
      historyCount: history.length,
    });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleAgentRestart(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  try {
    const session = sm.getSession(sessionId);
    const prevProvider = session?.lastStartConfig?.provider;
    const ccSessionId = session?.ccSessionId;

    const typedOpts = {
      systemPrompt: msg.systemPrompt as string | undefined,
      appendSystemPrompt: msg.appendSystemPrompt as string | undefined,
      allowedTools: msg.allowedTools as string[] | undefined,
      disallowedTools: msg.disallowedTools as string[] | undefined,
      mcpServers: msg.mcpServers as any,
    };

    const { config } = sm.restartSession(
      sessionId,
      {
        provider: msg.provider as string | undefined,
        modelProvider: msg.modelProvider as string | undefined,
        model: msg.model as string | undefined,
        permissionMode: msg.permissionMode as string | undefined,
        configDir: msg.configDir as string | undefined,
        extraArgs: msg.extraArgs as string[] | undefined,
        providerOptions: msg.providerOptions as Record<string, unknown> | undefined,
      },
      (cfg) => {
        const prov = getProvider(cfg.provider);
        const providerChanged = prevProvider && cfg.provider !== prevProvider;

        if (providerChanged) {
          // Cross-provider: inject DB history
          const history = buildCanonicalFromDb(sessionId);
          return prov.spawn({
            cwd: sm.getSession(sessionId)!.cwd,
            model: cfg.model,
            permissionMode: cfg.permissionMode as any,
            configDir: cfg.configDir,
            env: { ...(msg.env as Record<string, string>), SNA_SESSION_ID: sessionId },
            history: history.length > 0 ? history : undefined,
            extraArgs: cfg.extraArgs,
            providerOptions: cfg.providerOptions,
            ...typedOpts,
          });
        }

        // Same provider: native resume via resumeSessionId
        return prov.spawn({
          cwd: sm.getSession(sessionId)!.cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode as any,
          configDir: cfg.configDir,
          env: { ...(msg.env as Record<string, string>), SNA_SESSION_ID: sessionId },
          resumeSessionId: ccSessionId ?? undefined,
          extraArgs: cfg.extraArgs,
          providerOptions: cfg.providerOptions,
          ...typedOpts,
        });
      },
    );
    wsReply(ws, msg, { status: "restarted", provider: config.provider, sessionId });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleAgentInterrupt(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const interrupted = sm.interruptSession(sessionId);
  wsReply(ws, msg, { status: interrupted ? "interrupted" : "no_session" });
}

function handleAgentSetModel(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const model = msg.model as string;
  if (!model) return replyError(ws, msg, "model is required");
  const updated = sm.setSessionModel(sessionId, model);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", model });
}

function handleAgentSetPermissionMode(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const permissionMode = msg.permissionMode as string;
  if (!permissionMode) return replyError(ws, msg, "permissionMode is required");
  const updated = sm.setSessionPermissionMode(sessionId, permissionMode);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", permissionMode });
}

function handleAgentKill(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const killed = sm.killSession(sessionId);
  wsReply(ws, msg, { status: killed ? "killed" : "no_session" });
}

function handleAgentStatus(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = (msg.session as string) ?? "default";
  const session = sm.getSession(sessionId);
  const alive = session?.process?.alive ?? false;
  let messageCount = 0;
  let lastMessage: { actor: string; kind: string; content: string; created_at: string } | null = null;
  try {
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId) as any;
    messageCount = count?.c ?? 0;
    const last = db.prepare("SELECT actor, kind, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId) as any;
    if (last) lastMessage = { actor: last.actor, kind: last.kind, content: last.content, created_at: last.created_at };
  } catch {}
  wsReply(ws, msg, {
    alive,
    agentStatus: !alive ? "disconnected" : (session?.state === "processing" ? "busy" : "idle"),
    sessionId: session?.process?.sessionId ?? null,
    ccSessionId: session?.ccSessionId ?? null,
    eventCount: session?.eventCounter ?? 0,
    messageCount,
    lastMessage,
    config: session?.lastStartConfig ?? null,
  });
}

async function handleAgentRunOnce(ws: WebSocket, msg: WsRequest, sm: SessionManager): Promise<void> {
  if (!msg.message) return replyError(ws, msg, "message is required");
  try {
    const { result, usage } = await runOnce(sm, msg as unknown as RunOnceOptions);
    wsReply(ws, msg, { result, usage });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

async function handleAgentCompletion(ws: WebSocket, msg: WsRequest): Promise<void> {
  if (!msg.prompt) return replyError(ws, msg, "prompt is required");
  try {
    const result = await completion(msg as unknown as CompletionOptions);
    wsReply(ws, msg, result);
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

  // If since=0 (or includeHistory=true), replay DB history as events first
  const includeHistory = msg.since === 0 || msg.includeHistory === true;
  let cursor = 0;

  if (includeHistory) {
    // Replay all persisted messages from DB
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT actor, kind, content, meta, created_at FROM chat_messages
         WHERE session_id = ? ORDER BY id ASC`,
      ).all(sessionId) as { actor: string; kind: string; content: string; meta: string | null; created_at: string }[];

      for (const row of rows) {
        cursor++;
        // Map (actor, kind) → event type for replay. status blocks are bookkeeping and skipped.
        const eventType = row.actor === "user" ? "user_message"
          : row.actor === "assistant" && row.kind === "text" ? "assistant"
          : row.actor === "assistant" && row.kind === "thinking" ? "thinking"
          : row.actor === "assistant" && row.kind === "tool_use" ? "tool_use"
          : row.actor === "system" && row.kind === "tool_result" ? "tool_result"
          : row.actor === "system" && row.kind === "error" ? "error"
          : null;
        if (!eventType) continue;
        const meta = row.meta ? JSON.parse(row.meta) : undefined;
        send(ws, {
          type: "agent.event",
          session: sessionId,
          cursor,
          isHistory: true,
          event: {
            type: eventType,
            message: row.content,
            data: meta,
            timestamp: new Date(row.created_at).getTime(),
          },
        });
      }
    } catch { /* DB not ready */ }

    // Replay in-memory buffer events that haven't been persisted to DB yet.
    // These are events emitted since the last DB write (current turn in-flight).
    // Only include events whose counter exceeds the history cursor to avoid duplicates.
    if (cursor < session.eventCounter) {
      const unpersisted = session.eventCounter - cursor;
      const bufferSlice = session.eventBuffer.slice(-unpersisted);
      for (const event of bufferSlice) {
        cursor++;
        send(ws, { type: "agent.event", session: sessionId, cursor, event });
      }
    }
  } else {
    // No history — replay from since or current counter
    cursor = typeof msg.since === "number" && msg.since > 0 ? msg.since : session.eventCounter;
    if (cursor < session.eventCounter) {
      const startIdx = Math.max(0, session.eventBuffer.length - (session.eventCounter - cursor));
      const events = session.eventBuffer.slice(startIdx);
      for (const event of events) {
        cursor++;
        send(ws, { type: "agent.event", session: sessionId, cursor, event });
      }
    } else {
      cursor = session.eventCounter;
    }
  }

  // Subscribe to future events — pushed instantly, no polling.
  // cursor=-1 means a transient event (e.g. assistant_delta) with no persisted cursor.
  const unsub = sm.onSessionEvent(sessionId, (eventCursor, event) => {
    if (eventCursor === -1) {
      send(ws, { type: "agent.event", session: sessionId, event });
    } else {
      send(ws, { type: "agent.event", session: sessionId, cursor: eventCursor, event });
    }
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

// Slower poll interval — only catches events from external sources (CLI, HTTP from other processes)

function handleEventsSubscribe(ws: WebSocket, msg: WsRequest, sm: SessionManager, state: ConnState): void {
  // Cleanup existing subscription
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
      const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get() as { maxId: number | null };
      lastId = row.maxId ?? 0;
    } catch {
      lastId = 0;
    }
  }

  // Instant push for events emitted through this server (WS emit + HTTP POST /emit)
  state.skillEventUnsub = sm.onSkillEvent((event) => {
    const eventId = event.id as number;
    if (eventId > lastId) {
      lastId = eventId;
      send(ws, { type: "skill.event", data: event });
    }
  });

  // Slower DB poll to catch events from external sources (CLI emit.js, other processes)
  state.skillPollTimer = setInterval(() => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, session_id, skill, type, message, data, created_at
         FROM skill_events WHERE id > ? ORDER BY id ASC LIMIT 50`,
      ).all(lastId) as any[];
      for (const row of rows) {
        if ((row as any).id > lastId) {
          lastId = (row as any).id;
          send(ws, { type: "skill.event", data: row });
        }
      }
    } catch { /* DB not ready */ }
  }, getConfig().skillPollMs);

  reply(ws, msg, { lastId });
}

function handleEventsUnsubscribe(ws: WebSocket, msg: WsRequest, state: ConnState): void {
  state.skillEventUnsub?.();
  state.skillEventUnsub = null;
  if (state.skillPollTimer) {
    clearInterval(state.skillPollTimer);
    state.skillPollTimer = null;
  }
  reply(ws, msg, {});
}

function handleEmit(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
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
    const id = Number(result.lastInsertRowid);

    // Broadcast to all WS skill event subscribers
    sm.broadcastSkillEvent({
      id,
      session_id: sessionId ?? null,
      skill,
      type: eventType,
      message: emitMessage,
      data: data ?? null,
      created_at: new Date().toISOString(),
    });

    wsReply(ws, msg, { id });
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
  wsReply(ws, msg, { status: approved ? "approved" : "denied" });
}

function handlePermissionPending(ws: WebSocket, msg: WsRequest, sm: SessionManager): void {
  const sessionId = msg.session as string | undefined;
  if (sessionId) {
    const pending = sm.getPendingPermission(sessionId);
    wsReply(ws, msg, { pending: pending ? [{ sessionId, ...pending }] : [] });
  } else {
    wsReply(ws, msg, { pending: sm.getAllPendingPermissions() });
  }
}

function handlePermissionSubscribe(ws: WebSocket, msg: WsRequest, sm: SessionManager, state: ConnState): void {
  state.permissionUnsub?.();

  // Replay existing pending permissions
  const pending = sm.getAllPendingPermissions();
  for (const p of pending) {
    send(ws, { type: "permission.request", session: p.sessionId, request: p.request, createdAt: p.createdAt, isHistory: true });
  }

  // Subscribe to future permission requests
  state.permissionUnsub = sm.onPermissionRequest((sessionId, request, createdAt) => {
    send(ws, { type: "permission.request", session: sessionId, request, createdAt });
  });
  reply(ws, msg, { pendingCount: pending.length });
}

function handlePermissionUnsubscribe(ws: WebSocket, msg: WsRequest, state: ConnState): void {
  state.permissionUnsub?.();
  state.permissionUnsub = null;
  reply(ws, msg, {});
}

// ── Chat session handlers ─────────────────────────────────────────

function handleChatSessionsList(ws: WebSocket, msg: WsRequest): void {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, label, type, meta, cwd, created_at FROM chat_sessions ORDER BY created_at DESC`,
    ).all() as { id: string; label: string; type: string; meta: string | null; cwd: string | null; created_at: string }[];
    const sessions = rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
    wsReply(ws, msg, { sessions });
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
    wsReply(ws, msg, { status: "created", id, meta: (msg.meta as Record<string, unknown>) ?? null });
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
    wsReply(ws, msg, { status: "deleted" });
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
    wsReply(ws, msg, { messages });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}

function handleChatMessagesCreate(ws: WebSocket, msg: WsRequest): void {
  const sessionId = msg.session as string;
  if (!sessionId) return replyError(ws, msg, "session is required");
  const actor = msg.actor as import("../db/schema.js").ChatActor | undefined;
  const kind = msg.kind as import("../db/schema.js").ChatKind | undefined;
  if (!actor || !kind) return replyError(ws, msg, "actor and kind are required");
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
      .run(sessionId, sessionId);
    const id = insertChatMessage(db, {
      sessionId,
      actor,
      kind,
      content: (msg.content as string) ?? "",
      embeds: msg.embeds as Record<string, import("../history/types.js").EmbedRecord> | undefined,
      meta: msg.meta as Record<string, unknown> | undefined,
      skillName: (msg.skill_name as string) ?? undefined,
    });
    wsReply(ws, msg, { status: "created", id });
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
    wsReply(ws, msg, { status: "cleared" });
  } catch (e: any) {
    replyError(ws, msg, e.message);
  }
}
