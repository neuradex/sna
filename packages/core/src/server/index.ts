/**
 * createSnaApp — factory that returns a Hono app with all SNA core routes.
 *
 * @example
 * import { Hono } from "hono";
 * import { createSnaApp, attachWebSocket, SessionManager } from "@sna-sdk/core/server";
 *
 * const sessionManager = new SessionManager({ maxSessions: 10 });
 * const app = createSnaApp({ sessionManager });
 * const server = serve({ fetch: app.fetch, port: 3099 });
 * attachWebSocket(server, sessionManager);
 */

import _fs from "fs";
import _path from "path";
import { Hono } from "hono";
import { createAgentRoutes } from "./routes/agent.js";
import { createChatRoutes } from "./routes/chat.js";
import { SessionManager } from "./session-manager.js";

export interface SnaAppOptions {
  /** Session manager for multi-session support. Auto-created if omitted. */
  sessionManager?: SessionManager;
}

export function createSnaApp(options: SnaAppOptions = {}) {
  const sessionManager = options.sessionManager ?? new SessionManager();
  const app = new Hono();

  // Health check — used by consumers to verify this is an SNA server
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));

  // Agent routes (stdio spawn → SSE)
  app.route("/agent", createAgentRoutes(sessionManager));

  // Chat persistence routes
  app.route("/chat", createChatRoutes());

  return app;
}

export { createAgentRoutes } from "./routes/agent.js";
export { createChatRoutes } from "./routes/chat.js";
export { SessionManager } from "./session-manager.js";
export type {
  Session,
  SessionInfo,
  SessionManagerOptions,
  SessionLifecycleEvent,
  SessionLifecycleState,
  SessionConfigChangedEvent,
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
export function snaPortRoute(c: any) {
  const portFile = _path.join(process.cwd(), ".sna/sna-api.port");
  try {
    const port = _fs.readFileSync(portFile, "utf8").trim();
    return c.json({ port });
  } catch {
    return c.json({ port: null, error: "SNA API not running" }, 503);
  }
}
