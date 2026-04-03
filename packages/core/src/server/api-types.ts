/**
 * api-types.ts — Single source of truth for all API response shapes.
 *
 * Both HTTP routes and WS handlers MUST use these types via typed helpers.
 * TypeScript enforces that every response matches the defined shape,
 * preventing HTTP/WS drift.
 *
 * To add a new operation:
 *   1. Add the response type to ApiResponses
 *   2. Use httpJson(c, "op.name", data) in the HTTP route
 *   3. Use wsReply(ws, msg, data) with { type: "op.name" } in the WS handler
 *   4. TypeScript will error if shapes don't match
 */

import type { Context } from "hono";
import type { WebSocket } from "ws";
import type { SessionInfo } from "./session-manager.js";

// ── Response types (shared between HTTP and WS) ─────────────────

export interface ApiResponses {
  // Session CRUD
  "sessions.create": {
    status: "created";
    sessionId: string;
    label: string;
    meta: Record<string, unknown> | null;
  };
  "sessions.list": {
    sessions: SessionInfo[];
  };
  "sessions.update": {
    status: "updated";
    session: string;
  };
  "sessions.remove": {
    status: "removed";
  };

  // Agent lifecycle
  "agent.start": {
    status: "started" | "already_running";
    provider: string;
    sessionId: string;
  };
  "agent.send": {
    status: "sent";
  };
  "agent.resume": {
    status: "resumed";
    provider: string;
    sessionId: string;
    historyCount: number;
  };
  "agent.restart": {
    status: "restarted";
    provider: string;
    sessionId: string;
  };
  "agent.interrupt": {
    status: "interrupted" | "no_session";
  };
  "agent.set-model": {
    status: "updated" | "no_session";
    model: string;
  };
  "agent.set-permission-mode": {
    status: "updated" | "no_session";
    permissionMode: string;
  };
  "agent.kill": {
    status: "killed" | "no_session";
  };
  "agent.status": {
    alive: boolean;
    agentStatus: "idle" | "busy" | "disconnected";
    sessionId: string | null;
    ccSessionId: string | null;
    eventCount: number;
    messageCount: number;
    lastMessage: { role: string; content: string; created_at: string } | null;
    config: { provider: string; model: string; permissionMode: string; extraArgs?: string[] } | null;
  };
  "agent.run-once": {
    result: string;
    usage: Record<string, unknown> | null;
  };

  // Skill events
  "emit": {
    id: number;
  };

  // Permission
  "permission.respond": {
    status: "approved" | "denied";
  };
  "permission.pending": {
    pending: Array<{ sessionId: string; request: Record<string, unknown>; createdAt: number }>;
  };

  // Chat sessions
  "chat.sessions.list": {
    sessions: Array<{
      id: string;
      label: string;
      type: string;
      meta: Record<string, unknown> | null;
      cwd: string | null;
      created_at: string;
    }>;
  };
  "chat.sessions.create": {
    status: "created";
    id: string;
    meta: Record<string, unknown> | null;
  };
  "chat.sessions.remove": {
    status: "deleted";
  };

  // Chat messages
  "chat.messages.list": {
    messages: unknown[];
  };
  "chat.messages.create": {
    status: "created";
    id: number;
  };
  "chat.messages.clear": {
    status: "cleared";
  };
}

export type ApiOp = keyof ApiResponses;

// ── Typed helpers ────────────────────────────────────────────────

/**
 * Type-safe JSON response for HTTP routes.
 * Ensures the response body matches the defined shape for the operation.
 */
export function httpJson<K extends ApiOp>(
  c: Context,
  _op: K,
  data: ApiResponses[K],
  status?: number,
) {
  return c.json(data as any, status as any);
}

/**
 * Type-safe reply for WS handlers.
 * Ensures the response data matches the defined shape for the operation.
 */
export function wsReply<K extends ApiOp>(
  ws: WebSocket,
  msg: { type: string; rid?: string },
  data: ApiResponses[K],
): void {
  if (ws.readyState !== ws.OPEN) return;
  const out: Record<string, unknown> = { ...data, type: msg.type };
  if (msg.rid != null) out.rid = msg.rid;
  ws.send(JSON.stringify(out));
}
