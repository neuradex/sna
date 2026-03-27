/**
 * Agent routes — HTTP API for spawning and communicating with agent providers.
 *
 * Routes:
 *   POST /start   — create a new agent session (no initial prompt required)
 *   POST /send    — send a message; spawns `claude -p --resume` per message
 *   GET  /events  — SSE stream of agent events (stays open)
 *   POST /kill    — kill the agent session
 *   GET  /status  — check agent status
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getProvider,
  type AgentProcess,
  type AgentEvent,
} from "../../core/providers/index.js";
import { logger } from "../../lib/logger.js";

let currentProcess: AgentProcess | null = null;
const eventBuffer: AgentEvent[] = [];
let eventCounter = 0;

/** Pre-register an already-spawned agent process (called by standalone server before listen). */
export function setAgentProcess(proc: AgentProcess) {
  currentProcess = proc;
  subscribeEvents(proc);
}

function subscribeEvents(proc: AgentProcess) {
  proc.on("event", (e: AgentEvent) => {
    eventBuffer.push(e);
    eventCounter++;
    if (eventBuffer.length > 500) {
      eventBuffer.splice(0, eventBuffer.length - 500);
    }
  });
}

export function createAgentRoutes() {
  const app = new Hono();

  // POST /start — create agent session (idempotent: skips if already alive)
  app.post("/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      provider?: string;
      prompt?: string;
      model?: string;
      permissionMode?: string;
      force?: boolean;
    };

    // If agent is already alive and not forced, return existing session
    if (currentProcess?.alive && !body.force) {
      logger.log("route", "POST /start → already_running");
      return c.json({
        status: "already_running",
        provider: "claude-code",
        sessionId: currentProcess.sessionId,
      });
    }

    // Kill existing
    if (currentProcess?.alive) {
      currentProcess.kill();
    }
    // Clear buffer but keep eventCounter — SSE cursors depend on monotonic IDs
    eventBuffer.length = 0;

    const provider = getProvider(body.provider ?? "claude-code");

    try {
      currentProcess = provider.spawn({
        cwd: process.cwd(),
        prompt: body.prompt,
        model: body.model ?? "claude-sonnet-4-6",
        permissionMode: (body.permissionMode as any) ?? "acceptEdits",
      });

      subscribeEvents(currentProcess);
      logger.log("route", "POST /start → started");

      return c.json({
        status: "started",
        provider: provider.name,
      });
    } catch (e: any) {
      logger.err("err", "POST /start failed:", e.message);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // POST /send — send a message to the agent
  app.post("/send", async (c) => {
    if (!currentProcess?.alive) {
      logger.err("err", "POST /send → no active session (alive=false)");
      return c.json(
        {
          status: "error",
          message: "No active agent session. Call POST /start first.",
        },
        400,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as { message?: string };
    if (!body.message) {
      logger.err("err", "POST /send → empty message");
      return c.json({ status: "error", message: "message is required" }, 400);
    }

    logger.log("route", `POST /send → "${body.message.slice(0, 80)}"`);
    currentProcess.send(body.message);
    return c.json({ status: "sent" });
  });

  // GET /events — SSE stream (stays open indefinitely)
  app.get("/events", (c) => {
    const sinceParam = c.req.query("since");
    let cursor = sinceParam ? parseInt(sinceParam, 10) : eventCounter;

    return streamSSE(c, async (stream) => {
      const POLL_MS = 300;
      const KEEPALIVE_MS = 15_000;
      let lastSend = Date.now();

      // SSE stays open — agent may send multiple messages over time
      while (true) {
        if (cursor < eventCounter) {
          const startIdx = Math.max(
            0,
            eventBuffer.length - (eventCounter - cursor),
          );
          const newEvents = eventBuffer.slice(startIdx);

          for (const event of newEvents) {
            cursor++;
            await stream.writeSSE({
              id: String(cursor),
              data: JSON.stringify(event),
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

  // POST /kill
  app.post("/kill", async (c) => {
    if (currentProcess?.alive) {
      currentProcess.kill();
      return c.json({ status: "killed" });
    }
    return c.json({ status: "no_session" });
  });

  // GET /status
  app.get("/status", (c) => {
    return c.json({
      alive: currentProcess?.alive ?? false,
      sessionId: currentProcess?.sessionId ?? null,
      eventCount: eventCounter,
    });
  });

  return app;
}
