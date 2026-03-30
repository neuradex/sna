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
import { SessionManager } from "./session-manager.js";
import { getProvider } from "../core/providers/index.js";
import { logger } from "../lib/logger.js";

// Pre-flight: verify native modules are compatible before starting
import { getDb } from "../db/schema.js";
try {
  getDb();
} catch (err: any) {
  if (err.message?.includes("NODE_MODULE_VERSION")) {
    console.error(`\n✗  better-sqlite3 was compiled for a different Node.js version.`);
    console.error(`   Run: pnpm rebuild better-sqlite3\n`);
  } else {
    console.error(`\n✗  Database initialization failed: ${err.message}\n`);
  }
  process.exit(1);
}

const port = parseInt(process.env.SNA_PORT ?? "3099", 10);
const permissionMode = (process.env.SNA_PERMISSION_MODE ?? "acceptEdits") as "acceptEdits" | "bypassPermissions";
const defaultModel = process.env.SNA_MODEL ?? "claude-sonnet-4-6";
const maxSessions = parseInt(process.env.SNA_MAX_SESSIONS ?? "5", 10);

const root = new Hono();
root.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

// Global error handler — always return JSON with error details
root.onError((err, c) => {
  logger.err("err", `${c.req.method} ${new URL(c.req.url).pathname} → ${err.message}`);
  return c.json({ status: "error", message: err.message, stack: err.stack }, 500);
});

// Request logger with method coloring
const methodColor: Record<string, (s: string) => string> = {
  GET: chalk.green,
  POST: chalk.yellow,
  DELETE: chalk.red,
  OPTIONS: chalk.gray,
};
root.use("*", async (c, next) => {
  const m = c.req.method;
  const colorFn = methodColor[m] ?? chalk.white;
  const path = new URL(c.req.url).pathname;
  logger.log("req", `${colorFn(m.padEnd(6))} ${path}`);
  await next();
});

// 1. Create session manager and main session
const sessionManager = new SessionManager({ maxSessions });
sessionManager.createSession({ id: "default", cwd: process.cwd() });

// 2. Spawn agent into main session
const provider = getProvider("claude-code");
logger.log("sna", "spawning agent...");
const agentProcess = provider.spawn({ cwd: process.cwd(), permissionMode, model: defaultModel });
sessionManager.setProcess("default", agentProcess);

root.route("/", createSnaApp({ sessionManager }));

let server: ReturnType<typeof serve> | null = null;
let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  logger.log("sna", chalk.dim("stopping all sessions..."));
  sessionManager.killAll();
  if (server) {
    server.close(() => {
      logger.log("sna", chalk.green("clean shutdown") + chalk.dim(" — see you next time"));
      console.log("");
      process.exit(0);
    });
  }
  setTimeout(() => {
    logger.log("sna", chalk.green("shutdown complete"));
    console.log("");
    process.exit(0);
  }, 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
// Suppress errors during shutdown (e.g. IPC channel closed by tsx --watch)
process.on("uncaughtException", (err) => {
  if (shuttingDown) process.exit(0);
  console.error(err);
  process.exit(1);
});

// 3. Start listening immediately — agent receives messages when ready
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
