import * as hono_types from 'hono/types';
import { Hono } from 'hono';
import { SessionManager } from '../session-manager.js';
import '../../core/providers/types.js';

interface RunOnceOptions {
    message: string;
    model?: string;
    systemPrompt?: string;
    appendSystemPrompt?: string;
    permissionMode?: string;
    cwd?: string;
    timeout?: number;
    provider?: string;
    extraArgs?: string[];
}
interface RunOnceResult {
    result: string;
    usage: Record<string, unknown> | null;
}
/**
 * One-shot agent execution: create temp session → spawn → wait for result → cleanup.
 * Used by both HTTP POST /run-once and WS agent.run-once.
 */
declare function runOnce(sessionManager: SessionManager, opts: RunOnceOptions): Promise<RunOnceResult>;
declare function createAgentRoutes(sessionManager: SessionManager): Hono<hono_types.BlankEnv, hono_types.BlankSchema, "/">;

export { type RunOnceOptions, type RunOnceResult, createAgentRoutes, runOnce };
