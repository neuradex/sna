import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getProvider
} from "../../core/providers/index.js";
let currentProcess = null;
const eventBuffer = [];
let eventCounter = 0;
function setAgentProcess(proc) {
  currentProcess = proc;
  subscribeEvents(proc);
}
function subscribeEvents(proc) {
  proc.on("event", (e) => {
    eventBuffer.push(e);
    eventCounter++;
    if (eventBuffer.length > 500) {
      eventBuffer.splice(0, eventBuffer.length - 500);
    }
  });
}
function createAgentRoutes() {
  const app = new Hono();
  app.post("/start", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (currentProcess?.alive && !body.force) {
      return c.json({
        status: "already_running",
        provider: "claude-code",
        sessionId: currentProcess.sessionId
      });
    }
    if (currentProcess?.alive) {
      currentProcess.kill();
    }
    eventBuffer.length = 0;
    eventCounter = 0;
    const provider = getProvider(body.provider ?? "claude-code");
    try {
      currentProcess = provider.spawn({
        cwd: process.cwd(),
        prompt: body.prompt,
        permissionMode: body.permissionMode ?? "acceptEdits"
      });
      subscribeEvents(currentProcess);
      return c.json({
        status: "started",
        provider: provider.name
      });
    } catch (err) {
      return c.json({ status: "error", message: err.message }, 500);
    }
  });
  app.post("/send", async (c) => {
    if (!currentProcess?.alive) {
      return c.json(
        {
          status: "error",
          message: "No active agent session. Call POST /start first."
        },
        400
      );
    }
    const body = await c.req.json().catch(() => ({}));
    console.log(body);
    if (!body.message) {
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    currentProcess.send(body.message);
    return c.json({ status: "sent" });
  });
  app.get("/events", (c) => {
    const sinceParam = c.req.query("since");
    let cursor = sinceParam ? parseInt(sinceParam, 10) : eventCounter;
    return streamSSE(c, async (stream) => {
      const POLL_MS = 300;
      const KEEPALIVE_MS = 15e3;
      let lastSend = Date.now();
      while (true) {
        if (cursor < eventCounter) {
          const startIdx = Math.max(
            0,
            eventBuffer.length - (eventCounter - cursor)
          );
          const newEvents = eventBuffer.slice(startIdx);
          for (const event of newEvents) {
            cursor++;
            await stream.writeSSE({
              id: String(cursor),
              data: JSON.stringify(event)
            });
            lastSend = Date.now();
          }
        }
        if (Date.now() - lastSend > KEEPALIVE_MS) {
          await stream.writeSSE({ data: "" });
          lastSend = Date.now();
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    });
  });
  app.post("/kill", async (c) => {
    if (currentProcess?.alive) {
      currentProcess.kill();
      return c.json({ status: "killed" });
    }
    return c.json({ status: "no_session" });
  });
  app.get("/status", (c) => {
    return c.json({
      alive: currentProcess?.alive ?? false,
      sessionId: currentProcess?.sessionId ?? null,
      eventCount: eventCounter
    });
  });
  return app;
}
export {
  createAgentRoutes,
  setAgentProcess
};
