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
import path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SnaServerOptions {
  /** Port for the SNA API server. Default: 3099 */
  port?: number;

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
   * Extra env vars merged into the server process environment.
   * These take precedence over the launcher's defaults.
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
}

export interface SnaServerHandle {
  /** The forked child process. */
  process: ChildProcess;

  /** The port the server is listening on. */
  port: number;

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

// ── Core launcher ─────────────────────────────────────────────────────────────

/**
 * Launch the SNA standalone API server in a forked child process.
 *
 * Returns a handle once the server is ready to accept requests.
 * Throws if the server fails to start within `options.readyTimeout`.
 */
export async function startSnaServer(options: SnaServerOptions): Promise<SnaServerHandle> {
  const port = options.port ?? 3099;
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

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SNA_PORT: String(port),
    SNA_DB_PATH: options.dbPath,
    ...(options.maxSessions != null ? { SNA_MAX_SESSIONS: String(options.maxSessions) } : {}),
    ...(options.permissionMode ? { SNA_PERMISSION_MODE: options.permissionMode } : {}),
    ...(options.model ? { SNA_MODEL: options.model } : {}),
    ...(options.nativeBinding ? { SNA_SQLITE_NATIVE_BINDING: options.nativeBinding } : {}),
    ...(consumerModules ? { SNA_MODULES_PATH: consumerModules } : {}),
    ...(nodePath ? { NODE_PATH: nodePath } : {}),
    // Consumer overrides last so they can always win
    ...(options.env ?? {}),
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

  return {
    process: proc,
    port,
    stop() {
      proc.kill("SIGTERM");
    },
  };
}
