import * as hono_types from 'hono/types';
import { Hono } from 'hono';
export { eventsRoute } from './routes/events.js';
export { emitRoute } from './routes/emit.js';
export { createRunRoute } from './routes/run.js';
export { createAgentRoutes } from './routes/agent.js';
import 'hono/utils/http-status';
import '../core/providers/types.js';

interface SnaAppOptions {
    /** Commands available via GET /run?skill=<name> */
    runCommands?: Record<string, string[]>;
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

export { type SnaAppOptions, createSnaApp, snaPortRoute };
