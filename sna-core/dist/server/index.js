import { Hono } from "hono";
import { eventsRoute } from "./routes/events.js";
import { emitRoute } from "./routes/emit.js";
import { createRunRoute } from "./routes/run.js";
import { createAgentRoutes } from "./routes/agent.js";
function createSnaApp(options = {}) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));
  app.get("/events", eventsRoute);
  app.post("/emit", emitRoute);
  app.route("/agent", createAgentRoutes());
  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }
  return app;
}
import { eventsRoute as eventsRoute2 } from "./routes/events.js";
import { emitRoute as emitRoute2 } from "./routes/emit.js";
import { createRunRoute as createRunRoute2 } from "./routes/run.js";
import { createAgentRoutes as createAgentRoutes2 } from "./routes/agent.js";
export {
  createAgentRoutes2 as createAgentRoutes,
  createRunRoute2 as createRunRoute,
  createSnaApp,
  emitRoute2 as emitRoute,
  eventsRoute2 as eventsRoute
};
