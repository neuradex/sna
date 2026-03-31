/**
 * createSnaApp — factory that returns a Hono app with all SNA core routes.
 *
 * Mount this on your application's Hono instance:
 *
 * @example
 * import { Hono } from "hono";
 * import { createSnaApp } from "sna/server";
 *
 * const app = new Hono();
 * app.route("/sna", createSnaApp());
 * // → GET /sna/events, POST /sna/emit
 *
 * // With custom run commands:
 * app.route("/sna", createSnaApp({
 *   runCommands: {
 *     status: ["tsx", "scripts/status.ts"],
 *   },
 * }));
 * // → GET /sna/run?skill=status
 */

import _fs from "fs";
import _path from "path";
import { Hono } from "hono";
import { eventsRoute } from "./routes/events.js";
import { createEmitRoute } from "./routes/emit.js";
import { createRunRoute } from "./routes/run.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createChatRoutes } from "./routes/chat.js";
import { SessionManager } from "./session-manager.js";

export interface SnaAppOptions {
  /** Commands available via GET /run?skill=<name> */
  runCommands?: Record<string, string[]>;
  /** Session manager for multi-session support. Auto-created if omitted. */
  sessionManager?: SessionManager;
}

export function createSnaApp(options: SnaAppOptions = {}) {
  const sessionManager = options.sessionManager ?? new SessionManager();
  const app = new Hono();

  // Health check — used by consumers to verify this is an SNA server
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));

  // Skill event routes (SQLite → SSE)
  app.get("/events", eventsRoute);
  app.post("/emit", createEmitRoute(sessionManager));

  // Agent routes (stdio spawn → SSE)
  app.route("/agent", createAgentRoutes(sessionManager));

  // Chat persistence routes
  app.route("/chat", createChatRoutes());

  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }

  return app;
}

export { eventsRoute } from "./routes/events.js";
export { emitRoute, createEmitRoute } from "./routes/emit.js";
export { createRunRoute } from "./routes/run.js";
export { createAgentRoutes } from "./routes/agent.js";
export { createChatRoutes } from "./routes/chat.js";
export { SessionManager } from "./session-manager.js";
export type { Session, SessionInfo, SessionManagerOptions } from "./session-manager.js";
export { attachWebSocket } from "./ws.js";

/**
 * GET /api/sna-port handler for consumer servers.
 * Reads the dynamically allocated SNA API port from .sna/sna-api.port.
 *
 * @example
 * import { snaPortRoute } from "sna/server";
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
