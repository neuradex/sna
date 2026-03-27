import * as hono_types from 'hono/types';
import { Hono } from 'hono';
import { AgentProcess } from '../../core/providers/types.js';

/** Pre-register an already-spawned agent process (called by standalone server before listen). */
declare function setAgentProcess(proc: AgentProcess): void;
declare function createAgentRoutes(): Hono<hono_types.BlankEnv, hono_types.BlankSchema, "/">;

export { createAgentRoutes, setAgentProcess };
