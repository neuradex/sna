import * as hono_types from 'hono/types';
import { Hono } from 'hono';
import { SessionManager } from './session-manager.js';
export { AgentStatus, Session, SessionConfigChangedEvent, SessionInfo, SessionLifecycleEvent, SessionLifecycleState, SessionManagerOptions, StartConfig } from './session-manager.js';
export { createAgentRoutes } from './routes/agent.js';
export { createChatRoutes } from './routes/chat.js';
export { attachWebSocket } from './ws.js';
export { buildCanonicalFromDb } from '../history/canonical.js';
export { CompletionOptions, completion } from '../core/completion.js';
export { CompletionResult } from '../core/providers/types.js';
import 'ws';
import 'http';
import '../history/types.js';
import '../db/schema.js';
import 'better-sqlite3';

interface SnaAppOptions {
    /** Session manager for multi-session support. Auto-created if omitted. */
    sessionManager?: SessionManager;
}
declare function createSnaApp(options?: SnaAppOptions): Hono<hono_types.BlankEnv, hono_types.BlankSchema, "/">;

/**
 * GET /api/sna-port handler for consumer servers.
 * Reads the dynamically allocated SNA API port from .sna/sna-api.port.
 *
 * @example
 * import { snaPortRoute } from "@sna-sdk/core/server";
 * app.get("/api/sna-port", snaPortRoute);
 */
declare function snaPortRoute(c: any): any;

export { SessionManager, type SnaAppOptions, createSnaApp, snaPortRoute };
