/**
 * standalone.ts — SNA internal API server
 *
 * Started automatically by `sna up`. Consumers never interact with this directly.
 *
 * Runs on SNA_PORT (default: 3099), separate from the consumer's app server.
 * All SNA routes are mounted here so consumers only need <SnaProvider> — no
 * route mounting required.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import chalk from "chalk";
import { createSnaApp } from "./index.js";
import { getProvider } from "../core/providers/index.js";
import { setAgentProcess } from "./routes/agent.js";
import { logger } from "../lib/logger.js";

const port = parseInt(process.env.SNA_PORT ?? "3099", 10);
const permissionMode = (process.env.SNA_PERMISSION_MODE ?? "acceptEdits") as "acceptEdits" | "bypassPermissions";

const root = new Hono();
root.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// Request logger with method coloring
const methodColor: Record<string, (s: string) => string> = {
  GET: chalk.green,
  POST: chalk.yellow,
  OPTIONS: chalk.gray,
};
root.use("*", async (c, next) => {
  const m = c.req.method;
  const colorFn = methodColor[m] ?? chalk.white;
  const path = new URL(c.req.url).pathname;
  logger.log("req", `${colorFn(m.padEnd(4))} ${path}`);
  await next();
});

root.route("/", createSnaApp());

// 1. Spawn agent first
const provider = getProvider("claude-code");
logger.log("sna", "spawning agent...");
const agentProcess = provider.spawn({ cwd: process.cwd(), permissionMode });
setAgentProcess(agentProcess);

let server: ReturnType<typeof serve> | null = null;

function shutdown(signal: string) {
  logger.log("sna", `${signal} — shutting down`);
  logger.log("sna", "stopping Claude Code agent...");
  agentProcess.kill();
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// 2. Start listening immediately — agent receives messages when ready
server = serve({ fetch: root.fetch, port }, () => {
  console.log("");
  logger.log("sna", chalk.green.bold(`API server ready → http://localhost:${port}`));
  console.log("");
});

agentProcess.on("event", (e) => {
  if (e.type === "init") {
    logger.log("agent", chalk.green(`agent ready (session=${e.data?.sessionId ?? "?"})`));
  }
});
