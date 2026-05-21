import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import fs from "fs";
import http from "http";
import path from "path";

type RuntimePaths = {
  claudeCode?: string;
  codex?: string;
  opencode?: string;
  grok?: string;
  cursor?: string;
};

export type SnaDaemonState = "stopped" | "running" | "unresponsive";

export interface SnaDaemonHealth {
  ok?: boolean;
  name?: string;
  [key: string]: unknown;
}

export interface SnaDaemonStatus {
  state: SnaDaemonState;
  port: number;
  pid?: number;
  health?: SnaDaemonHealth;
  error?: string;
}

export interface SnaDaemonOptions {
  /** Port for the SNA API server. Default: 3099 */
  port?: number;

  /** Absolute path to the SQLite database file. Required. */
  dbPath: string;

  /** Working directory for the daemon process. Default: dirname(dbPath) */
  cwd?: string;

  /** Directory for daemon metadata files. Default: path.join(cwd, ".sna") */
  daemonDir?: string;

  /** Explicit pid file path. Default: path.join(daemonDir, "sna-daemon.pid") */
  pidPath?: string;

  /** Explicit log file path. Default: path.join(daemonDir, "sna-daemon.log") */
  logPath?: string;

  /** Test/debug escape hatch for launching a custom standalone-compatible script. */
  serverScript?: string;

  /** Maximum concurrent agent sessions. Default: server default */
  maxSessions?: number;

  /** Permission mode for Claude Code. Default: server default */
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default";

  /** Claude model to use. Default: server default */
  model?: string;

  /** Permission request timeout in milliseconds. Default: server default */
  permissionTimeoutMs?: number;

  /** Base data directory for images and generated artifacts. */
  dataDir?: string;

  /** Explicit path to the better-sqlite3 native .node binding. */
  nativeBinding?: string;

  /** Explicit CLI commands or absolute paths for agent runtimes. */
  runtimePaths?: RuntimePaths;

  /** Extra env vars merged into the daemon process environment. */
  env?: Record<string, string>;

  /** How long to wait for /health to become ready. Default: 15000 */
  readyTimeout?: number;

  /** HTTP health request timeout. Default: 1000 */
  healthTimeout?: number;

  /** How long to wait for graceful stop before SIGKILL. Default: 5000 */
  stopTimeout?: number;

  /**
   * Adopt an already healthy daemon on the same port instead of starting a
   * second process. Default: true.
   */
  adoptExisting?: boolean;
}

export interface SnaDaemonHandle {
  pid?: number;
  port: number;
  adopted: boolean;
  pidPath: string;
  logPath: string;
  status(): Promise<SnaDaemonStatus>;
  stop(): Promise<boolean>;
}

type DaemonPaths = {
  cwd: string;
  daemonDir: string;
  pidPath: string;
  logPath: string;
  portPath: string;
};

const require = createRequire(import.meta.url);

const runtimePathEnvKeys: Record<keyof RuntimePaths, string> = {
  claudeCode: "SNA_CLAUDE_COMMAND",
  codex: "SNA_CODEX_COMMAND",
  opencode: "SNA_OPENCODE_COMMAND",
  grok: "SNA_GROK_COMMAND",
  cursor: "SNA_CURSOR_COMMAND",
};

export class SnaDaemonManager {
  private readonly port: number;
  private readonly readyTimeout: number;
  private readonly healthTimeout: number;
  private readonly stopTimeout: number;
  private readonly paths: DaemonPaths;
  private pid?: number;
  private adopted = false;

  constructor(private readonly options: SnaDaemonOptions) {
    this.port = options.port ?? 3099;
    this.readyTimeout = options.readyTimeout ?? 15_000;
    this.healthTimeout = options.healthTimeout ?? 1_000;
    this.stopTimeout = options.stopTimeout ?? 5_000;

    const cwd = options.cwd ?? path.dirname(options.dbPath);
    const daemonDir = options.daemonDir ?? path.join(cwd, ".sna");
    this.paths = {
      cwd,
      daemonDir,
      pidPath: options.pidPath ?? path.join(daemonDir, "sna-daemon.pid"),
      logPath: options.logPath ?? path.join(daemonDir, "sna-daemon.log"),
      portPath: path.join(daemonDir, "sna-api.port"),
    };
  }

  async start(): Promise<SnaDaemonHandle> {
    fs.mkdirSync(this.paths.cwd, { recursive: true });
    fs.mkdirSync(this.paths.daemonDir, { recursive: true });

    const existing = await this.inspectExisting();
    if (isSnaHealth(existing.health)) {
      if (this.options.adoptExisting === false) {
        throw new Error(`SNA daemon is already running on port ${this.port}`);
      }
      this.pid = existing.pid;
      this.adopted = true;
      return this.createHandle();
    }

    if (existing.health) {
      throw new Error(`Port ${this.port} is already serving a non-SNA /health endpoint`);
    }

    if (existing.pid && processExists(existing.pid)) {
      throw new Error(`SNA daemon pid ${existing.pid} is running but /health is not ready`);
    }

    removeIfExists(this.paths.pidPath);
    const serverScript = this.options.serverScript ?? resolveStandaloneScript();
    const env = buildDaemonEnv(this.options, this.port);
    const logFd = fs.openSync(this.paths.logPath, "a");

    let childPid: number | undefined;
    try {
      const child = spawn(process.execPath, [serverScript], {
        cwd: this.paths.cwd,
        env,
        detached: true,
        stdio: ["ignore", logFd, logFd],
      });
      child.unref();
      childPid = child.pid;
      this.pid = childPid;
      this.adopted = false;

      if (!childPid) {
        throw new Error("SNA daemon process did not expose a pid");
      }

      fs.writeFileSync(this.paths.pidPath, String(childPid));
      fs.writeFileSync(this.paths.portPath, String(this.port));

      let exitError: Error | undefined;
      child.once("exit", (code, signal) => {
        exitError = new Error(
          `SNA daemon exited before becoming ready (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        );
      });
      child.once("error", (err) => {
        exitError = err;
      });

      await waitUntil(async () => {
        if (exitError) throw exitError;
        const health = await this.tryHealth();
        return isSnaHealth(health);
      }, this.readyTimeout);

      return this.createHandle();
    } catch (err) {
      if (childPid) {
        signalDaemon(childPid, "SIGTERM");
      }
      removeIfExists(this.paths.pidPath);
      throw err;
    } finally {
      fs.closeSync(logFd);
    }
  }

  async status(): Promise<SnaDaemonStatus> {
    const existing = await this.inspectExisting();
    if (isSnaHealth(existing.health)) {
      return { state: "running", port: this.port, pid: existing.pid, health: existing.health };
    }
    if (existing.pid && processExists(existing.pid)) {
      return {
        state: "unresponsive",
        port: this.port,
        pid: existing.pid,
        error: existing.error,
      };
    }
    return { state: "stopped", port: this.port, pid: existing.pid, error: existing.error };
  }

  async stop(): Promise<boolean> {
    if (this.adopted) return false;

    const pid = this.pid ?? readPid(this.paths.pidPath);
    if (!pid) return false;

    signalDaemon(pid, "SIGTERM");

    try {
      await waitUntil(async () => !isSnaHealth(await this.tryHealth()), this.stopTimeout);
    } catch {
      if (isSnaHealth(await this.tryHealth())) {
        signalDaemon(pid, "SIGKILL");
        await waitUntil(async () => !isSnaHealth(await this.tryHealth()), 2_000).catch(() => undefined);
      }
    }

    removeIfExists(this.paths.pidPath);
    removeIfExists(this.paths.portPath);
    this.pid = undefined;
    return true;
  }

  private async inspectExisting(): Promise<{ pid?: number; health?: SnaDaemonHealth; error?: string }> {
    const pid = this.pid ?? readPid(this.paths.pidPath);
    try {
      const health = await readHealth(this.port, this.healthTimeout);
      return { pid, health };
    } catch (err) {
      return { pid, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async tryHealth(): Promise<SnaDaemonHealth | undefined> {
    try {
      return await readHealth(this.port, this.healthTimeout);
    } catch {
      return undefined;
    }
  }

  private createHandle(): SnaDaemonHandle {
    return {
      pid: this.pid,
      port: this.port,
      adopted: this.adopted,
      pidPath: this.paths.pidPath,
      logPath: this.paths.logPath,
      status: () => this.status(),
      stop: () => this.stop(),
    };
  }
}

export async function startSnaDaemon(options: SnaDaemonOptions): Promise<SnaDaemonHandle> {
  return new SnaDaemonManager(options).start();
}

function resolveStandaloneScript(): string {
  const selfPath = fileURLToPath(import.meta.url);
  const selfDir = path.dirname(selfPath);
  const candidates = [
    path.resolve(selfDir, "../server/standalone.js"),
    path.resolve(selfDir, "server/standalone.js"),
  ].map(remapAsarPath);

  const script = candidates.find((candidate) => fs.existsSync(candidate));
  if (!script) {
    throw new Error(
      `SNA standalone script not found. Tried:\n${candidates.join("\n")}\n` +
      `Ensure "@sna-sdk/core" is built and listed in asarUnpack when packaging Electron apps.`,
    );
  }
  return script;
}

function remapAsarPath(candidate: string): string {
  if (candidate.includes(".asar") && !candidate.includes(".asar.unpacked")) {
    return candidate.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }
  return candidate;
}

function buildDaemonEnv(options: SnaDaemonOptions, port: number): Record<string, string> {
  let consumerModules: string | undefined;
  try {
    const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
    consumerModules = path.resolve(bsPkg, "../..");
  } catch {
    // peer dep will resolve normally in installed apps
  }

  const nodePath = buildNodePath();
  return {
    ...(process.env as Record<string, string>),
    SNA_PORT: String(port),
    SNA_DB_PATH: options.dbPath,
    ...(options.maxSessions != null ? { SNA_MAX_SESSIONS: String(options.maxSessions) } : {}),
    ...(options.permissionMode ? { SNA_PERMISSION_MODE: options.permissionMode } : {}),
    ...(options.model ? { SNA_MODEL: options.model } : {}),
    ...(options.permissionTimeoutMs != null ? { SNA_PERMISSION_TIMEOUT_MS: String(options.permissionTimeoutMs) } : {}),
    ...(options.dataDir ? { SNA_DATA_DIR: options.dataDir } : {}),
    ...(options.nativeBinding ? { SNA_SQLITE_NATIVE_BINDING: options.nativeBinding } : {}),
    ...(consumerModules ? { SNA_MODULES_PATH: consumerModules } : {}),
    ...(nodePath ? { NODE_PATH: nodePath } : {}),
    ...runtimePathsToEnv(options.runtimePaths),
    ...(options.env ?? {}),
    SNA_SUPERVISED: "daemon",
  };
}

function runtimePathsToEnv(runtimePaths?: RuntimePaths): Record<string, string> {
  const env: Record<string, string> = {};
  if (!runtimePaths) return env;
  for (const [runtime, envKey] of Object.entries(runtimePathEnvKeys) as Array<[keyof RuntimePaths, string]>) {
    const value = runtimePaths[runtime]?.trim();
    if (value) env[envKey] = value;
  }
  return env;
}

function buildNodePath(): string | undefined {
  const resourcesPath = (process as typeof process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return undefined;

  const unpacked = path.join(resourcesPath, "app.asar.unpacked", "node_modules");
  if (!fs.existsSync(unpacked)) return undefined;

  const existing = process.env.NODE_PATH;
  return existing ? `${unpacked}${path.delimiter}${existing}` : unpacked;
}

function readHealth(port: number, timeoutMs: number): Promise<SnaDaemonHealth> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/health",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`/health returned HTTP ${res.statusCode ?? "unknown"}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as SnaDaemonHealth);
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("/health request timed out"));
    });
    req.on("error", reject);
  });
}

async function waitUntil(predicate: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function isSnaHealth(health: SnaDaemonHealth | undefined): boolean {
  return health?.ok === true && health.name === "sna";
}

function readPid(pidPath: string): number | undefined {
  try {
    const raw = fs.readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalDaemon(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

function removeIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // non-fatal cleanup
  }
}
