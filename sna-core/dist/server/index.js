import { Hono } from "hono";
import { eventsRoute } from "./routes/events.js";
import { emitRoute } from "./routes/emit.js";
import { createRunRoute } from "./routes/run.js";
function createSnaApp(options = {}) {
  const app = new Hono();
  app.get("/events", eventsRoute);
  app.post("/emit", emitRoute);
  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }
  return app;
}
import { eventsRoute as eventsRoute2 } from "./routes/events.js";
import { emitRoute as emitRoute2 } from "./routes/emit.js";
import { createRunRoute as createRunRoute2 } from "./routes/run.js";
export {
  createRunRoute2 as createRunRoute,
  createSnaApp,
  emitRoute2 as emitRoute,
  eventsRoute2 as eventsRoute
};
