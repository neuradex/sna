import * as hono_types from 'hono/types';
import { Hono } from 'hono';
import { SessionManager } from '../session-manager.js';
import '../../core/providers/types.js';

declare function createAgentRoutes(sessionManager: SessionManager): Hono<hono_types.BlankEnv, hono_types.BlankSchema, "/">;

export { createAgentRoutes };
