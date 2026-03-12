import { NextRequest } from 'next/server';

/**
 * createRunHandler — factory for the /api/run SSE endpoint.
 *
 * Pass a map of allowed commands for your app. Each key is a skill name,
 * each value is the argv array to spawn (first element is the binary).
 *
 * @example
 * // src/app/api/run/route.ts
 * import path from "path";
 * import { createRunHandler } from "sna/api/run";
 *
 * const ROOT = process.cwd();
 * const TSX = path.join(ROOT, "node_modules/.bin/tsx");
 * const SNA_CORE = path.join(ROOT, "node_modules/sna");
 *
 * export const GET = createRunHandler({
 *   status: [TSX, path.join(SNA_CORE, "src/scripts/lna.ts"), "status"],
 *   collect: [TSX, "src/scripts/devlog.ts", "collect"],
 * });
 */

declare const runtime = "nodejs";
declare function createRunHandler(commands: Record<string, string[]>): (req: NextRequest) => Promise<Response>;

export { createRunHandler, runtime };
