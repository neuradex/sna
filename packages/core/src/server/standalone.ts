/**
 * standalone.ts — SNA standalone server entry point.
 *
 * Forked by `startSnaServer()` from `@sna-sdk/core/node` or `@sna-sdk/core/electron`.
 * Runs on SNA_PORT (default: 3099) and exposes the full HTTP + WebSocket API.
 * OpenAPI docs available at /docs
 */

import { serve } from "@hono/node-server";
import fs from "fs";
import path from "path";
import { SessionManager } from "./session-manager.js";
import { attachWebSocket } from "./ws.js";
import { getProvider } from "../core/providers/index.js";
import { logger } from "../lib/logger.js";
import { configuredAppMeta, getConfig } from "../config.js";
import { createSnaApp } from "./index.js";

// Pre-flight: verify native modules are compatible before starting
import { getDb } from "../db/schema.js";
try {
  getDb();
} catch (err: any) {
  if (err.message?.includes("NODE_MODULE_VERSION")) {
    console.error(`\n✗  better-sqlite3 was compiled for a different Node.js version.`);
    console.error(`   This usually happens when electron-rebuild overwrites the native binary.`);
    console.error(`   Pass nativeBinding to startSnaServer({ nativeBinding }) so the server`);
    console.error(`   loads the consumer app's electron-rebuilt copy instead.\n`);
  } else {
    console.error(`\n✗  Database initialization failed: ${err.message}\n`);
  }
  process.exit(1);
}

// All env parsing is done by config.ts — just read the resolved values
const { appId, port, host, authToken, allowedOrigins, defaultPermissionMode: permissionMode, model: defaultModel, maxSessions } = getConfig();
if (!authToken) {
  console.error("SNA_AUTH_TOKEN is required for standalone server mode.");
  process.exit(1);
}

let shutdownFromParentDisconnect: (() => void) | undefined;
process.on("disconnect", () => {
  if (shutdownFromParentDisconnect) shutdownFromParentDisconnect();
  else process.exit(0);
});

// 1. Create session manager and main session
const sessionManager = new SessionManager({ maxSessions });
sessionManager.getOrCreateSession("default", { cwd: process.cwd(), meta: configuredAppMeta() });

// 2. Spawn agent into main session
const provider = getProvider("claude-code");
logger.log("sna", "spawning agent...");
const agentProcess = provider.spawn({ cwd: process.cwd(), permissionMode, model: defaultModel });
sessionManager.setProcess("default", agentProcess);

async function start() {
  // Create OpenAPI app with Swagger UI at /docs
  const snaApp = await createSnaApp({ sessionManager, authToken, allowedOrigins });

  // Root wrapper with CORS, error handling, and request logging
  import("hono").then((honoModule) => {
    const Hono = honoModule.Hono;
    const root = new Hono();
    root.onError((err, c) => {
      logger.err("err", `${c.req.method} ${new URL(c.req.url).pathname} → ${err.message}`);
      return c.json({ status: "error", message: err.message, stack: err.stack }, 500);
    });

    root.use("*", async (c, next) => {
      const m = c.req.method;
      const path = new URL(c.req.url).pathname;
      logger.log("req", `${m.padEnd(6)} ${path}`);
      await next();
    });

    root.route("/", snaApp);

    let server: ReturnType<typeof serve> | null = null;
    let shuttingDown = false;

    function shutdown(signal: string) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("");
      logger.log("sna", "stopping all sessions...");
      sessionManager.killAll();
      // Pool dispose tears down the codex (and opencode) daemons spawned via
      // prepareRuntime. killAll only closes threads on pooled providers, so
      // without this the daemons would be reparented to init and survive the
      // SNA shutdown — taking their MCP server children with them.
      try {
        const { getRuntimePool } = require("../core/providers/index.js");
        getRuntimePool().dispose();
      } catch (err) {
        logger.err("sna", `runtime pool dispose failed: ${err}`);
      }
      if (server) {
        server.close(() => {
          logger.log("sna", "clean shutdown — see you next time");
          console.log("");
          process.exit(0);
        });
      }
      setTimeout(() => {
        logger.log("sna", "shutdown complete");
        console.log("");
        process.exit(0);
      }, 3000).unref();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    shutdownFromParentDisconnect = () => shutdown("parent process disconnected");
    process.on("uncaughtException", (err) => {
      if (shuttingDown) process.exit(0);
      console.error(err);
      process.exit(1);
    });

    // Start listening — agent receives messages when ready
    server = serve({ fetch: root.fetch, port, hostname: host }, () => {
      // Write port file so /api/sna-port works consistently (Electron + standalone)
      const portDir = path.join(process.cwd(), ".sna");
      const portFile = path.join(portDir, "sna-api.port");
      try {
        fs.mkdirSync(portDir, { recursive: true });
        fs.writeFileSync(portFile, String(port));
      } catch { /* non-fatal */ }

      console.log("");
      logger.log("sna", `API server ready → http://${host}:${port}`);
      if (appId) logger.log("sna", `App owner → ${appId}`);
      logger.log("sna", `WebSocket endpoint → ws://${host}:${port}/ws`);
      logger.log("sna", `OpenAPI docs → http://${host}:${port}/docs`);
      console.log("");
    });

    // Attach WebSocket on the same HTTP server
    attachWebSocket(server as unknown as import("http").Server, sessionManager, { authToken, allowedOrigins });

    agentProcess.on("event", (e) => {
      if (e.type === "init") {
        logger.log("agent", `agent ready (session=${e.data?.sessionId ?? "?"})`);
      }
    });
  });
}

start();
