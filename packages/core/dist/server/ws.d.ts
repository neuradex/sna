import { WebSocketServer } from 'ws';
import { Server } from 'http';
import { SessionManager } from './session-manager.js';
import '../core/providers/types.js';
import '../history/types.js';
import '../db/schema.js';
import 'better-sqlite3';

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
 *   permission.respond   { session?, approved }
 *   permission.pending   { session? }
 *   permission.subscribe {}              → pushes { type: "permission.request", session, request, createdAt }
 *   permission.unsubscribe {}
 *
 *   chat.sessions.list    {}
 *   chat.sessions.create  { id?, label?, chatType?, meta? }
 *                         NOTE: WS uses `chatType` (not `type`) because `type` is reserved
 *                         as the WS protocol routing field.
 *   chat.sessions.remove  { session }
 *   chat.messages.list    { session, since? }
 *   chat.messages.create  { session, actor, kind, content?, embeds?, meta? }
 *   chat.messages.clear   { session }
 */

/**
 * Attach a WebSocket server to an existing HTTP server.
 * Handles upgrade requests on the `/ws` path.
 */
declare function attachWebSocket(server: Server, sessionManager: SessionManager): WebSocketServer;

export { attachWebSocket };
