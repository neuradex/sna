import { Context } from 'hono';

/**
 * GET /run?skill=<name>
 *
 * Spawn a registered command and stream stdout/stderr as SSE.
 *
 * @example
 * import { createRunRoute } from "sna/server/routes/run";
 *
 * const runRoute = createRunRoute({
 *   status: [TSX, "src/scripts/sna.ts", "status"],
 *   collect: [TSX, "src/scripts/devlog.ts", "collect"],
 * });
 */

declare function createRunRoute(commands: Record<string, string[]>): (c: Context) => Response;

export { createRunRoute };
