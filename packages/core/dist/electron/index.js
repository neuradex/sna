import { fork } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";
import { resolveClaudeCli, validateClaudePath, cacheClaudePath, parseCommandVOutput } from "../core/providers/claude-code.js";
import path from "path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createSnaApp } from "../server/index.js";
import { SessionManager } from "../server/session-manager.js";
import { attachWebSocket } from "../server/ws.js";
import { setConfig, getConfig } from "../config.js";
import { getDb } from "../db/schema.js";
import { logger as snaLogger } from "../lib/logger.js";
function resolveStandaloneScript() {
  const selfPath = fileURLToPath(import.meta.url);
  let script = path.resolve(path.dirname(selfPath), "../server/standalone.js");
  if (script.includes(".asar") && !script.includes(".asar.unpacked")) {
    script = script.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }
  if (!fs.existsSync(script)) {
    throw new Error(
      `SNA standalone script not found: ${script}
Ensure "@sna-sdk/core" is listed in asarUnpack in your electron-builder config.`
    );
  }
  return script;
}
function buildNodePath() {
  const resourcesPath = process.resourcesPath;
  if (!resourcesPath) return void 0;
  const unpacked = path.join(resourcesPath, "app.asar.unpacked", "node_modules");
  if (!fs.existsSync(unpacked)) return void 0;
  const existing = process.env.NODE_PATH;
  return existing ? `${unpacked}${path.delimiter}${existing}` : unpacked;
}
async function startSnaServer(options) {
  const port = options.port ?? 3099;
  const cwd = options.cwd ?? path.dirname(options.dbPath);
  const readyTimeout = options.readyTimeout ?? 15e3;
  const { onLog } = options;
  const standaloneScript = resolveStandaloneScript();
  const nodePath = buildNodePath();
  let consumerModules;
  try {
    const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
    consumerModules = path.resolve(bsPkg, "../..");
  } catch {
  }
  const env = {
    ...process.env,
    SNA_PORT: String(port),
    SNA_DB_PATH: options.dbPath,
    ...options.maxSessions != null ? { SNA_MAX_SESSIONS: String(options.maxSessions) } : {},
    ...options.permissionMode ? { SNA_PERMISSION_MODE: options.permissionMode } : {},
    ...options.model ? { SNA_MODEL: options.model } : {},
    ...options.permissionTimeoutMs != null ? { SNA_PERMISSION_TIMEOUT_MS: String(options.permissionTimeoutMs) } : {},
    ...options.dataDir ? { SNA_DATA_DIR: options.dataDir } : {},
    ...options.nativeBinding ? { SNA_SQLITE_NATIVE_BINDING: options.nativeBinding } : {},
    ...consumerModules ? { SNA_MODULES_PATH: consumerModules } : {},
    ...nodePath ? { NODE_PATH: nodePath } : {},
    // Consumer overrides last so they can always win
    ...options.env ?? {}
  };
  const proc = fork(standaloneScript, [], {
    cwd,
    env,
    stdio: "pipe"
  });
  let stdoutBuf = "";
  let isReady = false;
  const readyListeners = [];
  proc.stdout?.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (onLog) onLog(line);
      if (!isReady && line.includes("API server ready")) {
        isReady = true;
        readyListeners.splice(0).forEach((cb) => cb());
      }
    }
  });
  proc.stderr?.on("data", (chunk) => {
    if (onLog) {
      chunk.toString().split("\n").filter(Boolean).forEach(onLog);
    }
  });
  await new Promise((resolve, reject) => {
    if (isReady) return resolve();
    const timer = setTimeout(() => {
      reject(new Error(`SNA server did not become ready within ${readyTimeout}ms`));
    }, readyTimeout);
    readyListeners.push(() => {
      clearTimeout(timer);
      resolve();
    });
    proc.on("exit", (code) => {
      if (!isReady) {
        clearTimeout(timer);
        reject(new Error(`SNA server process exited (code=${code ?? "null"}) before becoming ready`));
      }
    });
    proc.on("error", (err) => {
      if (!isReady) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
  return {
    process: proc,
    port,
    stop() {
      proc.kill("SIGTERM");
    }
  };
}
async function startSnaServerInProcess(options) {
  const port = options.port ?? 3099;
  const cwd = options.cwd ?? path.dirname(options.dbPath);
  if (options.onLog) {
    snaLogger.setOnLog(options.onLog);
  }
  snaLogger.setLogLevel(options.logLevel ?? "info");
  setConfig({
    port,
    dbPath: options.dbPath,
    ...options.dataDir ? { dataDir: options.dataDir } : {},
    ...options.maxSessions != null ? { maxSessions: options.maxSessions } : {},
    ...options.permissionMode ? { defaultPermissionMode: options.permissionMode } : {},
    ...options.model ? { model: options.model } : {},
    ...options.permissionTimeoutMs != null ? { permissionTimeoutMs: options.permissionTimeoutMs } : {}
  });
  process.env.SNA_PORT = String(port);
  process.env.SNA_DB_PATH = options.dbPath;
  if (options.maxSessions != null) process.env.SNA_MAX_SESSIONS = String(options.maxSessions);
  if (options.permissionMode) process.env.SNA_PERMISSION_MODE = options.permissionMode;
  if (options.model) process.env.SNA_MODEL = options.model;
  if (options.permissionTimeoutMs != null) process.env.SNA_PERMISSION_TIMEOUT_MS = String(options.permissionTimeoutMs);
  if (options.dataDir) process.env.SNA_DATA_DIR = options.dataDir;
  if (options.nativeBinding) process.env.SNA_SQLITE_NATIVE_BINDING = options.nativeBinding;
  if (!process.env.SNA_MODULES_PATH) {
    try {
      const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
      process.env.SNA_MODULES_PATH = path.resolve(bsPkg, "../..");
    } catch {
    }
  }
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
  } catch {
  }
  try {
    getDb();
  } catch (err) {
    process.chdir(originalCwd);
    throw new Error(`SNA in-process: database init failed: ${err.message}`);
  }
  process.chdir(originalCwd);
  const config = getConfig();
  const root = new Hono();
  root.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
  root.onError((err, c) => {
    const pathname = new URL(c.req.url).pathname;
    snaLogger.err("err", `${c.req.method} ${pathname} \u2192 ${err.message}`);
    return c.json({ status: "error", message: err.message, stack: err.stack }, 500);
  });
  root.use("*", async (c, next) => {
    const m = c.req.method;
    const pathname = new URL(c.req.url).pathname;
    snaLogger.log("req", `${m.padEnd(6)} ${pathname}`);
    await next();
  });
  const sessionManager = new SessionManager({ maxSessions: config.maxSessions });
  root.route("/", createSnaApp({ sessionManager }));
  const httpServer = serve({ fetch: root.fetch, port }, () => {
    snaLogger.log("sna", `API server ready \u2192 http://localhost:${port}`);
    snaLogger.log("sna", `WebSocket endpoint \u2192 ws://localhost:${port}/ws`);
  });
  attachWebSocket(httpServer, sessionManager);
  if (options.langfuse) {
    setConfig({ langfuse: options.langfuse });
    try {
      const { initTracer } = await import("../lib/langfuse-tracer.js");
      await initTracer(options.langfuse, sessionManager, options.onLog);
    } catch (err) {
      if (options.onLog) options.onLog(`Langfuse tracer init skipped: ${err.message}`);
    }
  }
  return {
    process: null,
    port,
    sessionManager,
    httpServer,
    async initLangfuse(config2) {
      setConfig({ langfuse: config2 });
      try {
        const { initTracer } = await import("../lib/langfuse-tracer.js");
        await initTracer(config2, sessionManager, options.onLog);
      } catch (err) {
        if (options.onLog) options.onLog(`Langfuse tracer init skipped: ${err.message}`);
      }
    },
    async setTracerUser(userId, userEmail) {
      try {
        const { setTracerUser: _setUser } = await import("../lib/langfuse-tracer.js");
        _setUser(userId, userEmail);
      } catch {
      }
    },
    async stop() {
      try {
        const { shutdownTracer } = await import("../lib/langfuse-tracer.js");
        await shutdownTracer();
      } catch {
      }
      sessionManager.killAll();
      snaLogger.setOnLog(null);
      snaLogger.setLogLevel("info");
      await new Promise((resolve) => {
        httpServer.close(() => resolve());
        setTimeout(() => resolve(), 3e3).unref();
      });
    }
  };
}
export {
  cacheClaudePath,
  parseCommandVOutput,
  resolveClaudeCli,
  startSnaServer,
  startSnaServerInProcess,
  validateClaudePath
};
