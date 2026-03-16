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

import { Hono } from "hono";
import { eventsRoute } from "./routes/events.js";
import { emitRoute } from "./routes/emit.js";
import { createRunRoute } from "./routes/run.js";

export interface SnaAppOptions {
  /** Commands available via GET /run?skill=<name> */
  runCommands?: Record<string, string[]>;
}

export function createSnaApp(options: SnaAppOptions = {}) {
  const app = new Hono();

  app.get("/events", eventsRoute);
  app.post("/emit", emitRoute);

  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }

  return app;
}

export { eventsRoute } from "./routes/events.js";
export { emitRoute } from "./routes/emit.js";
export { createRunRoute } from "./routes/run.js";
