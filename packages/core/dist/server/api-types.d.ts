import * as hono from 'hono';
import { Context } from 'hono';
import { WebSocket } from 'ws';
import { SessionInfo } from './session-manager.js';
import '../core/providers/types.js';

interface ApiResponses {
    "sessions.create": {
        status: "created";
        sessionId: string;
        label: string;
        meta: Record<string, unknown> | null;
    };
    "sessions.list": {
        sessions: SessionInfo[];
    };
    "sessions.remove": {
        status: "removed";
    };
    "agent.start": {
        status: "started" | "already_running";
        provider: string;
        sessionId: string;
    };
    "agent.send": {
        status: "sent";
    };
    "agent.kill": {
        status: "killed" | "no_session";
    };
    "agent.status": {
        alive: boolean;
        sessionId: string | null;
        eventCount: number;
    };
    "agent.run-once": {
        result: string;
        usage: Record<string, unknown> | null;
    };
    "emit": {
        id: number;
    };
    "permission.respond": {
        status: "approved" | "denied";
    };
    "permission.pending": {
        pending: Array<{
            sessionId: string;
            request: Record<string, unknown>;
            createdAt: number;
        }>;
    };
    "chat.sessions.list": {
        sessions: Array<{
            id: string;
            label: string;
            type: string;
            meta: Record<string, unknown> | null;
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
type ApiOp = keyof ApiResponses;
/**
 * Type-safe JSON response for HTTP routes.
 * Ensures the response body matches the defined shape for the operation.
 */
declare function httpJson<K extends ApiOp>(c: Context, _op: K, data: ApiResponses[K], status?: number): Response & hono.TypedResponse<any, any, "json">;
/**
 * Type-safe reply for WS handlers.
 * Ensures the response data matches the defined shape for the operation.
 */
declare function wsReply<K extends ApiOp>(ws: WebSocket, msg: {
    type: string;
    rid?: string;
}, data: ApiResponses[K]): void;

export { type ApiOp, type ApiResponses, httpJson, wsReply };
