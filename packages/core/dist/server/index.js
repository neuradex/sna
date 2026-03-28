import _fs from "fs";
import _path from "path";
import { Hono } from "hono";
import { eventsRoute } from "./routes/events.js";
import { emitRoute } from "./routes/emit.js";
import { createRunRoute } from "./routes/run.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createChatRoutes } from "./routes/chat.js";
import { SessionManager } from "./session-manager.js";
function createSnaApp(options = {}) {
  const sessionManager = options.sessionManager ?? new SessionManager();
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));
  app.get("/events", eventsRoute);
  app.post("/emit", emitRoute);
  app.route("/agent", createAgentRoutes(sessionManager));
  app.route("/chat", createChatRoutes());
  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }
  return app;
}
import { eventsRoute as eventsRoute2 } from "./routes/events.js";
import { emitRoute as emitRoute2 } from "./routes/emit.js";
import { createRunRoute as createRunRoute2 } from "./routes/run.js";
import { createAgentRoutes as createAgentRoutes2 } from "./routes/agent.js";
import { createChatRoutes as createChatRoutes2 } from "./routes/chat.js";
import { SessionManager as SessionManager2 } from "./session-manager.js";
function snaPortRoute(c) {
  const portFile = _path.join(process.cwd(), ".sna/sna-api.port");
  try {
    const port = _fs.readFileSync(portFile, "utf8").trim();
    return c.json({ port });
  } catch {
    return c.json({ port: null, error: "SNA API not running" }, 503);
  }
}
export {
  SessionManager2 as SessionManager,
  createAgentRoutes2 as createAgentRoutes,
  createChatRoutes2 as createChatRoutes,
  createRunRoute2 as createRunRoute,
  createSnaApp,
  emitRoute2 as emitRoute,
  eventsRoute2 as eventsRoute,
  snaPortRoute
};
