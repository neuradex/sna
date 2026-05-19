/**
 * createSnaApp — factory that returns a Hono app with all SNA core routes.
 *
 * This is the unified app factory used by both standalone and in-process modes.
 * It delegates to createOpenApiApp which includes OpenAPI spec generation and
 * Swagger UI at /docs.
 *
 * @example
 * import { createSnaApp, attachWebSocket, SessionManager } from "@sna-sdk/core/server";
 *
 * const sessionManager = new SessionManager({ maxSessions: 10 });
 * const app = await createSnaApp({ sessionManager });
 * const server = serve({ fetch: app.fetch, port: 3099 });
 * attachWebSocket(server, sessionManager);
 */

import { SessionManager } from "./session-manager.js";

export interface SnaAppOptions {
  /** Session manager for multi-session support. Auto-created if omitted. */
  sessionManager?: SessionManager;
}

export async function createSnaApp(options: SnaAppOptions = {}) {
  const { createOpenApiApp } = await import("./routes/openapi.js");
  return createOpenApiApp(options);
}

export { SessionManager } from "./session-manager.js";
export { runOnce } from "./run-once.js";
export type { RunOnceOptions, RunOnceResult } from "./run-once.js";
export type {
  Session,
  SessionInfo,
  SessionManagerOptions,
  SessionLifecycleEvent,
  SessionLifecycleState,
  SessionConfigChangedEvent,
  SessionConfig,
  StartConfig,
  AgentStatus,
} from "./session-manager.js";
export { attachWebSocket } from "./ws.js";
export { buildCanonicalFromDb } from "../history/canonical.js";
export { completion } from "../core/completion.js";
export type { CompletionOptions, CompletionResult } from "../core/completion.js";

/**
 * GET /api/sna-port handler for consumer servers.
 * Reads the dynamically allocated SNA API port from .sna/sna-api.port.
 *
 * @example
 * import { snaPortRoute } from "@sna-sdk/core/server";
 * app.get("/api/sna-port", snaPortRoute);
 */
import fs from "fs";
import path from "path";

export function snaPortRoute(c: any) {
  const portFile = path.join(process.cwd(), ".sna/sna-api.port");
  try {
    const port = fs.readFileSync(portFile, "utf8").trim();
    return c.json({ port: parseInt(port, 10) });
  } catch {
    return c.json({ port: null, error: "SNA API not running" }, 503);
  }
}
