import { ChildProcess } from 'child_process';
import http from 'http';
export { ResolveResult, cacheClaudePath, parseCommandVOutput, resolveClaudeCli, validateClaudePath } from '../core/providers/claude-code.js';
import { SessionManager } from '../server/session-manager.js';
import '../core/providers/types.js';

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

interface SnaServerOptions {
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
interface SnaServerHandle {
    /** The forked child process. */
    process: ChildProcess;
    /** The port the server is listening on. */
    port: number;
    /** Send SIGTERM to the server process for graceful shutdown. */
    stop(): void;
}
/**
 * Launch the SNA standalone API server in a forked child process.
 *
 * Returns a handle once the server is ready to accept requests.
 * Throws if the server fails to start within `options.readyTimeout`.
 */
declare function startSnaServer(options: SnaServerOptions): Promise<SnaServerHandle>;
interface InProcessSnaServerHandle {
    /** No child process — the server runs in the calling process. */
    process: null;
    /** The port the server is listening on. */
    port: number;
    /** The session manager instance. */
    sessionManager: SessionManager;
    /** The underlying HTTP server. */
    httpServer: http.Server;
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
declare function startSnaServerInProcess(options: SnaServerOptions): Promise<InProcessSnaServerHandle>;

export { type InProcessSnaServerHandle, type SnaServerHandle, type SnaServerOptions, startSnaServer, startSnaServerInProcess };
