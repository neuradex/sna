/**
 * @sna-sdk/core/electron — Electron launcher API
 *
 * Provides startSnaServer() to launch the SNA standalone server as a forked
 * child process from an Electron main process. Handles asar path resolution,
 * native module binding detection, env construction, and ready detection
 * automatically.
 *
 * @example
 * const { startSnaServer } = require("@sna-sdk/core/electron");
 *
 * const sna = await startSnaServer({
 *   port: 3099,
 *   dbPath: path.join(app.getPath("userData"), "sna.db"),
 *   maxSessions: 20,
 *   permissionMode: "acceptEdits",
 *   onLog: (line) => console.log("[sna]", line),
 * });
 *
 * // sna.process — ChildProcess ref
 * // sna.port    — actual port
 * // sna.stop()  — graceful shutdown
 *
 * @remarks
 * **asarUnpack requirement**: for the fork to work, @sna-sdk/core must be
 * outside the asar bundle. Add to your electron-builder config:
 *
 *   asarUnpack: ["node_modules/@sna-sdk/core/**"]
 *
 * The forked server process runs on Electron's Node.js. The launcher
 * automatically detects the consumer app's electron-rebuilt native modules
 * and passes their path to the server process, so better-sqlite3 just works
 * without any manual configuration.
 */

import { fork, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";
import http from "http";

// Re-export CLI resolution utilities for consumer app setup/preflight screens.
export { resolveClaudeCli, validateClaudePath, cacheClaudePath, parseCommandVOutput } from "../core/providers/claude-code.js";
export type { ResolveResult } from "../core/providers/claude-code.js";
export { resolveCodexCli, validateCodexPath, cacheCodexPath } from "../core/providers/codex.js";
export type { CodexResolveResult } from "../core/providers/codex.js";
export { resolveOpenCodeCli, validateOpenCodePath, cacheOpenCodePath } from "../core/providers/opencode.js";
export type { OpenCodeResolveResult } from "../core/providers/opencode.js";
export { resolveGrokPath } from "../core/providers/grok.js";
export { resolveCursorPath } from "../core/providers/cursor.js";
export type { LogLevel } from "../lib/logger.js";
import path from "path";

// In-process mode imports
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createSnaApp } from "../server/index.js";
import { SessionManager } from "../server/session-manager.js";
import { attachWebSocket } from "../server/ws.js";
import { generateSnaAuthToken } from "../server/security.js";
import { setConfig, getConfig } from "../config.js";
import { getDb } from "../db/schema.js";
import { logger as snaLogger, type LogLevel } from "../lib/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SnaServerOptions {
  /** Port for the SNA API server. Default: 3099 */
  port?: number;

  /** Hostname to bind. Default: 127.0.0.1 */
  host?: string;

  /**
   * Application owner ID for this SNA server instance.
   * Defaults to "sna-sdk" when launched through the SDK.
   */
  appId?: string;

  /**
   * Bearer token required for protected HTTP and WebSocket routes.
   * When omitted, launchers generate one and return it on the handle.
   */
  authToken?: string;

  /**
   * Browser origins allowed to call SNA. Native clients that do not send
   * Origin are allowed, but browser requests must match this list.
   */
  allowedOrigins?: string[];

  /** Absolute path to the SQLite database file. Required. */
  dbPath: string;

  /**
   * Working directory for the server process.
   * Default: dirname(dbPath)
   */
  cwd?: string;

  /** Maximum concurrent agent sessions. Default: 5 */
  maxSessions?: number;

  /**
   * Permission mode for Claude Code.
   * Default: "acceptEdits"
   */
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default";

  /** Claude model to use. Default: SDK default (claude-sonnet-4-6) */
  model?: string;

  /**
   * Permission request timeout (ms). 0 = no timeout (app controls).
   * Default: 0 (app is responsible for responding or timing out)
   */
  permissionTimeoutMs?: number;

  /**
   * Explicit path to the better-sqlite3 native .node binding.
   *
   * When omitted, the launcher auto-detects from:
   *   1. app.asar.unpacked/node_modules/better-sqlite3/build/Release/...
   *   2. The SDK's local node_modules (dev / non-packaged)
   *
   * Set this if you have a custom Node.js-compiled binary at a known location.
   */
  nativeBinding?: string;

  /**
   * Extra env vars merged into the server process environment. Runtime command
   * variables here take precedence over values generated from `runtimePaths`.
   */
  env?: Record<string, string>;

  /**
   * How long to wait for the server to become ready, in milliseconds.
   * Default: 15000 (15 seconds)
   */
  readyTimeout?: number;

  /**
   * Called with each log line emitted by the server process (stdout + stderr).
   * Useful for forwarding to your app's logger.
   */
  onLog?: (line: string) => void;

  /**
   * Base data directory for images, etc.
   * Default: path.join(path.dirname(dbPath), "..")  (i.e., parent of db dir)
   */
  dataDir?: string;

  /**
   * Controls verbosity of log output sent to `onLog` and console.
   * File recording (.dev.log) is unaffected — all levels are always written.
   *
   * - `"info"`:   all output (default, current behavior)
   * - `"warn"`:   errors + agent lifecycle only; HTTP request logs excluded
   * - `"error"`:  errors only
   * - `"silent"`: no onLog calls (file recording continues)
   *
   * @default "info"
   */
  logLevel?: LogLevel;

  /**
   * Explicit CLI commands or absolute paths for agent runtimes.
   *
   * These map to the same environment variables used by the lower-level
   * provider resolvers:
   * - claudeCode -> SNA_CLAUDE_COMMAND
   * - codex      -> SNA_CODEX_COMMAND
   * - opencode   -> SNA_OPENCODE_COMMAND
   * - grok       -> SNA_GROK_COMMAND
   * - cursor     -> SNA_CURSOR_COMMAND
   *
   * Values may be absolute binary paths or wrapper commands. `env` is merged
   * after this object, so `env.SNA_*_COMMAND` remains the final escape hatch.
   */
  runtimePaths?: RuntimePaths;

  /**
   * Optional Langfuse tracing config.
   * When present, sessions with `meta.langfuseTrace: true` emit Langfuse traces.
   * Requires `langfuse` npm package installed.
   */
  langfuse?: {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
  };

}

export interface RuntimePaths {
  /** Claude Code CLI command/path. Maps to SNA_CLAUDE_COMMAND. */
  claudeCode?: string;
  /** Codex CLI command/path. Maps to SNA_CODEX_COMMAND. */
  codex?: string;
  /** OpenCode CLI command/path. Maps to SNA_OPENCODE_COMMAND. */
  opencode?: string;
  /** Grok CLI command/path. Maps to SNA_GROK_COMMAND. */
  grok?: string;
  /** Cursor headless agent CLI command/path. Maps to SNA_CURSOR_COMMAND. */
  cursor?: string;
}

export interface SnaServerConnection {
  /** Base HTTP URL for this server. */
  baseUrl: string;

  /** Bearer token required for protected routes. */
  authToken: string;
}

export interface SnaServerHandle extends SnaServerConnection {
  /** The forked child process. */
  process: ChildProcess;

  /** The port the server is listening on. */
  port: number;

  /** The host the server is bound to. */
  host: string;

  /** Application owner ID associated with this server process. */
  appId: string;

  /** Portable client connection object for SnaClient/SnaProvider. */
  connection: SnaServerConnection;

  /** Send SIGTERM to the server process for graceful shutdown. */
  stop(): void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the standalone.js script path.
 *
 * When running inside a packaged Electron asar bundle, the file must be in
 * app.asar.unpacked — a raw file on disk — for fork() to work.
 */
function resolveStandaloneScript(): string {
  // import.meta.url → dist/electron/index.js → dist/server/standalone.js
  const selfPath = fileURLToPath(import.meta.url);
  let script = path.resolve(path.dirname(selfPath), "../server/standalone.js");

  // Remap .asar → .asar.unpacked so fork() gets a real filesystem path
  if (script.includes(".asar") && !script.includes(".asar.unpacked")) {
    script = script.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }

  if (!fs.existsSync(script)) {
    throw new Error(
      `SNA standalone script not found: ${script}\n` +
      `Ensure "@sna-sdk/core" is listed in asarUnpack in your electron-builder config.`
    );
  }

  return script;
}

/**
 * Build NODE_PATH that includes app.asar.unpacked/node_modules so the
 * forked process can resolve native modules that are excluded from the asar.
 *
 * Only meaningful in packaged Electron apps.
 */
function buildNodePath(): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (!resourcesPath) return undefined;

  const unpacked = path.join(resourcesPath, "app.asar.unpacked", "node_modules");
  if (!fs.existsSync(unpacked)) return undefined;

  const existing = process.env.NODE_PATH;
  return existing ? `${unpacked}${path.delimiter}${existing}` : unpacked;
}

const runtimePathEnvKeys: Record<keyof RuntimePaths, string> = {
  claudeCode: "SNA_CLAUDE_COMMAND",
  codex: "SNA_CODEX_COMMAND",
  opencode: "SNA_OPENCODE_COMMAND",
  grok: "SNA_GROK_COMMAND",
  cursor: "SNA_CURSOR_COMMAND",
};

export function runtimePathsToEnv(runtimePaths?: RuntimePaths): Record<string, string> {
  const env: Record<string, string> = {};
  if (!runtimePaths) return env;
  for (const [runtime, envKey] of Object.entries(runtimePathEnvKeys) as Array<[keyof RuntimePaths, string]>) {
    const value = runtimePaths[runtime]?.trim();
    if (value) env[envKey] = value;
  }
  return env;
}

function applyProcessEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

// ── Core launcher ─────────────────────────────────────────────────────────────

/**
 * Launch the SNA standalone API server in a forked child process.
 *
 * Returns a handle once the server is ready to accept requests.
 * Throws if the server fails to start within `options.readyTimeout`.
 */
export async function startSnaServer(options: SnaServerOptions): Promise<SnaServerHandle> {
  const port = options.port ?? 3099;
  const host = options.host ?? "127.0.0.1";
  const appId = options.appId ?? "sna-sdk";
  const authToken = options.authToken ?? generateSnaAuthToken();
  const allowedOrigins = options.allowedOrigins ?? [];
  const cwd = options.cwd ?? path.dirname(options.dbPath);
  const readyTimeout = options.readyTimeout ?? 15_000;
  const { onLog } = options;

  const standaloneScript = resolveStandaloneScript();
  const nodePath = buildNodePath();

  // Resolve consumer's node_modules for the forked process.
  // Needed when SDK is symlinked (link:) — published installs resolve via peer dep naturally.
  let consumerModules: string | undefined;
  try {
    const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
    consumerModules = path.resolve(bsPkg, "../..");
  } catch { /* not found — peer dep will resolve normally */ }

  const runtimeEnv = runtimePathsToEnv(options.runtimePaths);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...runtimeEnv,
    // Consumer env remains the escape hatch for runtime CLI variables and
    // provider-specific settings. Launcher-owned security and process identity
    // values are written below so the returned handle always matches the child.
    ...(options.env ?? {}),
    SNA_PORT: String(port),
    SNA_HOST: host,
    SNA_APP_ID: appId,
    SNA_AUTH_TOKEN: authToken,
    SNA_ALLOWED_ORIGINS: allowedOrigins.join(","),
    SNA_DB_PATH: options.dbPath,
    ...(options.maxSessions != null ? { SNA_MAX_SESSIONS: String(options.maxSessions) } : {}),
    ...(options.permissionMode ? { SNA_PERMISSION_MODE: options.permissionMode } : {}),
    ...(options.model ? { SNA_MODEL: options.model } : {}),
    ...(options.permissionTimeoutMs != null ? { SNA_PERMISSION_TIMEOUT_MS: String(options.permissionTimeoutMs) } : {}),
    ...(options.dataDir ? { SNA_DATA_DIR: options.dataDir } : {}),
    ...(options.nativeBinding ? { SNA_SQLITE_NATIVE_BINDING: options.nativeBinding } : {}),
    ...(consumerModules ? { SNA_MODULES_PATH: consumerModules } : {}),
    ...(nodePath ? { NODE_PATH: nodePath } : {}),
  };

  const proc = fork(standaloneScript, [], {
    cwd,
    env,
    stdio: "pipe",
  });

  // Set up persistent log forwarding and ready detection in one pass
  let stdoutBuf = "";
  let isReady = false;
  const readyListeners: Array<() => void> = [];

  proc.stdout?.on("data", (chunk: Buffer) => {
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

  proc.stderr?.on("data", (chunk: Buffer) => {
    if (onLog) {
      chunk.toString().split("\n").filter(Boolean).forEach(onLog);
    }
  });

  await new Promise<void>((resolve, reject) => {
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

  const connection = { baseUrl: `http://${host}:${port}`, authToken };

  return {
    process: proc,
    port,
    host,
    appId,
    baseUrl: connection.baseUrl,
    authToken,
    connection,
    stop() {
      proc.kill("SIGTERM");
    },
  };
}

// ── In-process mode ──────────────────────────────────────────────────────────

export interface InProcessSnaServerHandle extends SnaServerConnection {
  /** No child process — the server runs in the calling process. */
  process: null;

  /** The port the server is listening on. */
  port: number;

  /** The host the server is bound to. */
  host: string;

  /** Application owner ID associated with this server instance. */
  appId: string;

  /** Portable client connection object for SnaClient/SnaProvider. */
  connection: SnaServerConnection;

  /** The session manager instance. */
  sessionManager: SessionManager;

  /** The underlying HTTP server. */
  httpServer: http.Server;

  /** Initialize Langfuse tracer after startup (e.g., when config arrives via IPC). */
  initLangfuse(config: { publicKey: string; secretKey: string; baseUrl?: string }): Promise<void>;

  /** Set user info for Langfuse traces. */
  setTracerUser(userId?: string, userEmail?: string): void;

  /** Graceful shutdown: kill all sessions and close the HTTP server. */
  stop(): Promise<void>;
}

/**
 * Launch the SNA API server **in-process** (no fork).
 *
 * Designed for Electron main processes where fork() causes problems:
 * - asar module resolution failures
 * - PATH / env propagation issues
 * - orphaned child processes on crash
 *
 * The server runs on the same Node.js event loop as the caller. Use `stop()`
 * to tear down cleanly (e.g., in Electron's `before-quit` handler).
 *
 * Unlike fork mode, this does **not** spawn a default agent — the consumer
 * controls session/agent lifecycle via the returned `sessionManager` or via
 * the WebSocket / HTTP API.
 */
export async function startSnaServerInProcess(
  options: SnaServerOptions,
): Promise<InProcessSnaServerHandle> {
  const port = options.port ?? 3099;
  const host = options.host ?? "127.0.0.1";
  const appId = options.appId ?? "sna-sdk";
  const authToken = options.authToken ?? generateSnaAuthToken();
  const allowedOrigins = options.allowedOrigins ?? [];
  const cwd = options.cwd ?? path.dirname(options.dbPath);

  // Route ALL SNA SDK logger output through the consumer's onLog callback.
  // Without this, logger.log() calls in claude-code.ts, session-manager.ts,
  // langfuse-tracer.ts, etc. go to console.log which Electron stdout doesn't
  // capture via onLog.
  if (options.onLog) {
    snaLogger.setOnLog(options.onLog);
  }

  // Apply log level filtering (default: "info" = current behavior)
  snaLogger.setLogLevel(options.logLevel ?? "info");

  applyProcessEnv({
    ...runtimePathsToEnv(options.runtimePaths),
    ...(options.env ?? {}),
  });

  // Configure SNA SDK before any module reads config
  setConfig({
    appId,
    port,
    host,
    authToken,
    allowedOrigins,
    dbPath: options.dbPath,
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    ...(options.maxSessions != null ? { maxSessions: options.maxSessions } : {}),
    ...(options.permissionMode ? { defaultPermissionMode: options.permissionMode } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.permissionTimeoutMs != null ? { permissionTimeoutMs: options.permissionTimeoutMs } : {}),
  });

  // Also set env vars so any module reading process.env directly works
  process.env.SNA_PORT = String(port);
  process.env.SNA_HOST = host;
  process.env.SNA_APP_ID = appId;
  process.env.SNA_AUTH_TOKEN = authToken;
  process.env.SNA_ALLOWED_ORIGINS = allowedOrigins.join(",");
  process.env.SNA_DB_PATH = options.dbPath;
  if (options.maxSessions != null) process.env.SNA_MAX_SESSIONS = String(options.maxSessions);
  if (options.permissionMode) process.env.SNA_PERMISSION_MODE = options.permissionMode;
  if (options.model) process.env.SNA_MODEL = options.model;
  if (options.permissionTimeoutMs != null) process.env.SNA_PERMISSION_TIMEOUT_MS = String(options.permissionTimeoutMs);
  if (options.dataDir) process.env.SNA_DATA_DIR = options.dataDir;
  if (options.nativeBinding) process.env.SNA_SQLITE_NATIVE_BINDING = options.nativeBinding;

  // Resolve consumer's node_modules for better-sqlite3.
  // In-process mode: the consumer's Electron-rebuilt native module must be used
  // (not .sna/native/ which is compiled for system Node.js).
  if (!process.env.SNA_MODULES_PATH) {
    try {
      const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
      process.env.SNA_MODULES_PATH = path.resolve(bsPkg, "../..");
    } catch { /* peer dep will resolve normally */ }
  }

  // Set CWD for the server context
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
  } catch {
    // cwd may not exist yet — that's fine, DB will create it
  }

  // Initialize DB (validates native module compatibility)
  try {
    getDb();
  } catch (err: any) {
    process.chdir(originalCwd);
    throw new Error(`SNA in-process: database init failed: ${err.message}`);
  }

  // Restore cwd — chdir was only needed for DB init (better-sqlite3 native binding resolution).
  // Leaving cwd at data/db/ breaks child process spawns (ENOTDIR) for session dirs.
  process.chdir(originalCwd);

  const config = getConfig();

  const root = new Hono();
  // Global error handler
  root.onError((err, c) => {
    const pathname = new URL(c.req.url).pathname;
    snaLogger.err("err", `${c.req.method} ${pathname} → ${err.message}`);
    return c.json({ status: "error", message: err.message, stack: err.stack }, 500);
  });

  // Request logger — routed through snaLogger so logLevel filtering applies
  root.use("*", async (c, next) => {
    const m = c.req.method;
    const pathname = new URL(c.req.url).pathname;
    snaLogger.log("req", `${m.padEnd(6)} ${pathname}`);
    await next();
  });

  // Create session manager (no default agent spawn)
  const sessionManager = new SessionManager({ maxSessions: config.maxSessions });

  const snaApp = await createSnaApp({ sessionManager, authToken, allowedOrigins });
  root.route("/", snaApp);

  // Start HTTP server
  const httpServer = serve({ fetch: root.fetch, port, hostname: host }, () => {
    snaLogger.log("sna", `API server ready → http://${host}:${port}`);
    snaLogger.log("sna", `WebSocket endpoint → ws://${host}:${port}/ws`);
  }) as unknown as http.Server;

  // Attach WebSocket on the same HTTP server
  attachWebSocket(httpServer, sessionManager, { authToken, allowedOrigins });

  // Initialize Langfuse tracer if configured
  if (options.langfuse) {
    setConfig({ langfuse: options.langfuse });
    try {
      const { initTracer } = await import("../lib/langfuse-tracer.js");
      await initTracer(options.langfuse, sessionManager, options.onLog);
    } catch (err: any) {
      if (options.onLog) options.onLog(`Langfuse tracer init skipped: ${err.message}`);
    }
  }

  const connection = { baseUrl: `http://${host}:${port}`, authToken };

  return {
    process: null,
    port,
    host,
    appId,
    baseUrl: connection.baseUrl,
    authToken,
    connection,
    sessionManager,
    httpServer,
    async initLangfuse(config) {
      setConfig({ langfuse: config });
      try {
        const { initTracer } = await import("../lib/langfuse-tracer.js");
        await initTracer(config, sessionManager, options.onLog);
      } catch (err: any) {
        if (options.onLog) options.onLog(`Langfuse tracer init skipped: ${err.message}`);
      }
    },
    async setTracerUser(userId?: string, userEmail?: string) {
      try {
        const { setTracerUser: _setUser } = await import("../lib/langfuse-tracer.js");
        _setUser(userId, userEmail);
      } catch { /* */ }
    },
    async stop() {
      // Shutdown Langfuse tracer (flush pending events)
      try {
        const { shutdownTracer } = await import("../lib/langfuse-tracer.js");
        await shutdownTracer();
      } catch { /* langfuse not loaded — skip */ }
      sessionManager.killAll();
      // Dispose pooled runtimes — without this the codex app-server daemons
      // spawned by prepareRuntime are reparented to init when the SNA host
      // process exits and keep running (along with their MCP children).
      try {
        const { getRuntimePool } = await import("../core/providers/index.js");
        getRuntimePool().dispose();
      } catch { /* pool not initialized — nothing to dispose */ }
      // Clear the logger callback and reset level to avoid leaking references after shutdown
      snaLogger.setOnLog(null);
      snaLogger.setLogLevel("info");
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Force-close after 3 seconds if connections linger
        setTimeout(() => resolve(), 3000).unref();
      });
    },
  };
}
