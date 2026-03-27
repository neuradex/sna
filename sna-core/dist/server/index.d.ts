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

export { type SnaAppOptions, createSnaApp };
