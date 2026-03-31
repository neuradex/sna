import * as hono_types from 'hono/types';
import { Hono } from 'hono';
import { SessionManager } from './session-manager.js';
export { Session, SessionInfo, SessionLifecycleEvent, SessionLifecycleState, SessionManagerOptions } from './session-manager.js';
export { eventsRoute } from './routes/events.js';
export { createEmitRoute, emitRoute } from './routes/emit.js';
export { createRunRoute } from './routes/run.js';
export { createAgentRoutes } from './routes/agent.js';
export { createChatRoutes } from './routes/chat.js';
export { attachWebSocket } from './ws.js';
import '../core/providers/types.js';
import 'hono/utils/http-status';
import 'ws';
import 'http';

interface SnaAppOptions {
    /** Commands available via GET /run?skill=<name> */
    runCommands?: Record<string, string[]>;
    /** Session manager for multi-session support. Auto-created if omitted. */
    sessionManager?: SessionManager;
}
declare function createSnaApp(options?: SnaAppOptions): Hono<hono_types.BlankEnv, hono_types.BlankSchema, "/">;

/**
 * GET /api/sna-port handler for consumer servers.
 * Reads the dynamically allocated SNA API port from .sna/sna-api.port.
 *
 * @example
 * import { snaPortRoute } from "sna/server";
 * app.get("/api/sna-port", snaPortRoute);
 */
declare function snaPortRoute(c: any): any;

export { SessionManager, type SnaAppOptions, createSnaApp, snaPortRoute };
