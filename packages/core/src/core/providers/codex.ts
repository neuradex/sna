import { spawn, execSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  AgentProvider,
  AgentProcess,
  AgentEvent,
  SpawnOptions,
  ContentBlock,
  CompleteOptions,
  CompletionResult,
  ListModelsConfig,
  ListModelsResult,
  RuntimeModelInfo,
  McpServerConfig,
} from "./types.js";
import { canonicalToCodexResponseItems } from "../../history/codex.js";
import { logger } from "../../lib/logger.js";

const SHELL = process.env.SHELL || "/bin/zsh";

// ── Codex binary resolution ─────────────────────────────────────────────────

export function validateCodexPath(codexPath: string): { ok: boolean; version?: string } {
  try {
    const codexDir = path.dirname(codexPath);
    const env = { ...process.env, PATH: `${codexDir}:${process.env.PATH ?? ""}` };
    const out = execSync(`"${codexPath}" --version`, {
      encoding: "utf8", stdio: "pipe", timeout: 10_000, env,
    }).trim();
    return { ok: true, version: out.split("\n")[0].slice(0, 50) };
  } catch {
    return { ok: false };
  }
}

export function cacheCodexPath(codexPath: string, cacheDir?: string): void {
  const dir = cacheDir ?? path.join(process.cwd(), ".sna");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "codex-path"), codexPath);
  } catch { /* best effort */ }
}

export interface CodexResolveResult {
  path: string;
  version?: string;
  source: "env" | "cache" | "static" | "shell" | "fallback";
}

export function resolveCodexCli(opts?: { cacheDir?: string }): CodexResolveResult {
  const cacheDir = opts?.cacheDir;

  // 1. Env override
  if (process.env.SNA_CODEX_COMMAND) {
    const v = validateCodexPath(process.env.SNA_CODEX_COMMAND);
    return { path: process.env.SNA_CODEX_COMMAND, version: v.version, source: "env" };
  }

  // 2. Cache
  const cacheFile = cacheDir
    ? path.join(cacheDir, "codex-path")
    : path.join(process.cwd(), ".sna/codex-path");
  try {
    const cached = fs.readFileSync(cacheFile, "utf8").trim();
    if (cached) {
      const v = validateCodexPath(cached);
      if (v.ok) return { path: cached, version: v.version, source: "cache" };
    }
  } catch { /* no cache */ }

  // 3. Static paths
  const staticPaths = [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    `${process.env.HOME}/.local/bin/codex`,
    `${process.env.HOME}/.cargo/bin/codex`,
    `${process.env.HOME}/.codex/bin/codex`,
  ];
  for (const p of staticPaths) {
    const v = validateCodexPath(p);
    if (v.ok) {
      cacheCodexPath(p, cacheDir);
      return { path: p, version: v.version, source: "static" };
    }
  }

  // 4. Shell detection
  try {
    const raw = execSync(`${SHELL} -i -l -c "command -v codex" 2>/dev/null`, {
      encoding: "utf8", timeout: 5000,
    }).trim();
    if (raw && raw !== "codex" && raw.startsWith("/")) {
      const v = validateCodexPath(raw);
      if (v.ok) {
        cacheCodexPath(raw, cacheDir);
        return { path: raw, version: v.version, source: "shell" };
      }
    }
  } catch { /* shell detection failed */ }

  // 5. Not found
  return { path: "codex", source: "fallback" };
}

function resolveCodexPath(cwd: string): string {
  const result = resolveCodexCli({ cacheDir: path.join(cwd, ".sna") });
  logger.log("agent", `codex path: ${result.source}=${result.path}${result.version ? ` (${result.version})` : ""}`);
  return result.path;
}

// ── Permission mode → Codex sandbox mapping ─────────────────────────────────

/** @internal Exported for testing only. Maps SNA permissionMode → thread/start sandbox value (kebab-case). */
export function toCodexSandbox(mode?: string): string {
  switch (mode) {
    case "bypassPermissions": return "danger-full-access";
    case "acceptEdits": return "workspace-write";
    default: return "read-only";
  }
}

/** Maps SNA permissionMode → turn/start sandboxPolicy value (camelCase). */
function toCodexSandboxPolicy(mode: string): string {
  switch (mode) {
    case "bypassPermissions": return "dangerFullAccess";
    case "acceptEdits": return "workspaceWrite";
    default: return "readOnly";
  }
}

// ── History injection ───────────────────────────────────────────────────────
//
// Codex's thread/resume RPC accepts an experimental `history` field taking
// ResponseItem[]. The provider enables that feature flag on session start
// and packs canonical blocks through the adapter in history/codex.ts.
// No XML prefix, no synthesized "Continue from where we left off" turn.

/**
 * Extract --resume <threadId> from extraArgs.
 * Returns the threadId and cleaned args, or null if not found.
 */
/** @internal Exported for testing only. */
export function extractResumeArg(extraArgs?: string[]): { threadId: string; cleanArgs: string[] } | null {
  if (!extraArgs) return null;
  const idx = extraArgs.indexOf("--resume");
  if (idx === -1) return null;

  const threadId = extraArgs[idx + 1];
  // "--resume" without value means "resume last" — not applicable for Codex
  if (!threadId || threadId.startsWith("--")) return null;

  const cleanArgs = [...extraArgs];
  cleanArgs.splice(idx, 2);
  return { threadId, cleanArgs };
}

/**
 * Extract system prompt flags from extraArgs.
 * Maps Claude Code flags to Codex thread/start params:
 *   --system-prompt <text>         → baseInstructions
 *   --append-system-prompt <text>  → developerInstructions
 */
/** @internal Exported for testing only. */
export function extractSystemPromptArgs(extraArgs?: string[]): {
  baseInstructions?: string;
  developerInstructions?: string;
  cleanArgs: string[];
} {
  if (!extraArgs) return { cleanArgs: [] };
  const cleanArgs = [...extraArgs];
  let baseInstructions: string | undefined;
  let developerInstructions: string | undefined;

  // Extract --system-prompt
  const sysIdx = cleanArgs.indexOf("--system-prompt");
  if (sysIdx !== -1 && sysIdx + 1 < cleanArgs.length) {
    baseInstructions = cleanArgs[sysIdx + 1];
    cleanArgs.splice(sysIdx, 2);
  }

  // Extract --append-system-prompt
  const appendIdx = cleanArgs.indexOf("--append-system-prompt");
  if (appendIdx !== -1 && appendIdx + 1 < cleanArgs.length) {
    developerInstructions = cleanArgs[appendIdx + 1];
    cleanArgs.splice(appendIdx, 2);
  }

  return { baseInstructions, developerInstructions, cleanArgs };
}

// ── JSON-RPC helpers ────────────────────────────────────────────────────────

let rpcIdCounter = 0;

interface JsonRpcRequest {
  method: string;
  id?: number;
  params?: Record<string, unknown>;
}

// ── PreToolUse hook merge ─────────────────────────────────────────────────
//
// Codex consumes hooks.json with shape:
//   { hooks: { PreToolUse: [{ matcher: <regex>, hooks: [{type, command, …}] }] } }
//
// SNA's provider always writes its own permission-bridge + tool-filter
// scripts in a single ".*" matcher. Consumers (e.g. Loom) can supply extra
// matchers — for example, a Bash-only wrapper that rewrites long-running
// commands. Those extra matchers append after SNA's so the canonical
// permission + filter chain runs first.
//
// Mirrors `mergeAppSettings()` in claude-code.ts; kept as a pure function
// to make the merge testable without spinning up a CodexProvider instance.

export interface CodexHookEntry {
  type: string;
  command: string;
  timeout?: number;
}

export interface CodexHookMatcher {
  matcher: string;
  hooks: CodexHookEntry[];
}

export interface CodexHooksJson {
  hooks: { PreToolUse: CodexHookMatcher[] };
}

/**
 * Build the hooks.json content from SNA's internal PreToolUse chain plus
 * any consumer-provided settings.
 *
 * @param internalHooks Permission/tool-filter scripts SNA always wants to run.
 * @param appSettings   Optional `providerOptions.settings` object — the same
 *                      shape claude-code accepts. Only `hooks.PreToolUse`
 *                      (an array of `{matcher, hooks}` entries) is honored
 *                      here; other settings keys are ignored because Codex
 *                      has no equivalent surface.
 * @returns The hooks.json payload, or null when nothing needs to be written.
 *
 * @internal Exported for unit tests.
 */
/**
 * Write MCP server config + hooks.json into a CODEX_HOME so the daemon
 * spawned against it loads the consumer's tooling. Shared between the
 * pooled (prepareRuntime) and non-pooled spawn paths so a CODEX_HOME never
 * lacks the entries the caller asked for — pre-refactor, only the
 * non-pooled spawn applied this, so pooled daemons booted without MCP
 * servers and tool calls silently failed.
 *
 * Idempotent for repeat callers on the same CODEX_HOME — config.toml is
 * appended to and codex_hooks is enabled at most once.
 */
export function applyCodexConfig(
  codexHome: string,
  opts: {
    mcpServers?: Record<string, McpServerConfig>;
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
    providerOptions?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
  },
  pkgRoot: string,
): void {
  const configTomlPath = path.join(codexHome, "config.toml");

  // MCP server injection.
  if (opts.mcpServers && Object.keys(opts.mcpServers).length > 0) {
    const existing = fs.existsSync(configTomlPath) ? fs.readFileSync(configTomlPath, "utf8") : "";
    const tomlLines: string[] = [];
    for (const [name, cfg] of Object.entries(opts.mcpServers)) {
      // Skip names already present so a repeat call doesn't duplicate
      // entries that crash the daemon with "duplicate key" at parse time.
      if (existing.includes(`[mcp_servers.${name}]`)) continue;
      if ("url" in cfg) {
        tomlLines.push(`[mcp_servers.${name}]`);
        tomlLines.push(`url = ${JSON.stringify(cfg.url)}`);
        if (cfg.headers) {
          tomlLines.push(`[mcp_servers.${name}.headers]`);
          for (const [k, v] of Object.entries(cfg.headers)) {
            tomlLines.push(`${k} = ${JSON.stringify(v)}`);
          }
        }
      } else {
        tomlLines.push(`[mcp_servers.${name}]`);
        tomlLines.push(`command = ${JSON.stringify(cfg.command)}`);
        if (cfg.args?.length) tomlLines.push(`args = ${JSON.stringify(cfg.args)}`);
        if (cfg.cwd) tomlLines.push(`cwd = ${JSON.stringify(cfg.cwd)}`);
        if (cfg.env && Object.keys(cfg.env).length > 0) {
          tomlLines.push(`[mcp_servers.${name}.env]`);
          for (const [k, v] of Object.entries(cfg.env)) {
            tomlLines.push(`${k} = ${JSON.stringify(v)}`);
          }
        }
      }
      tomlLines.push("");
    }
    if (tomlLines.length > 0) {
      fs.appendFileSync(configTomlPath, "\n" + tomlLines.join("\n"));
      logger.log("agent", `codex: ${tomlLines.filter((l) => l.startsWith("[mcp_servers.")).length} MCP servers injected`);
    }
  }

  // Hook injection: permission hook + tool filter + consumer hooks.
  const preToolUseHooks: CodexHookEntry[] = [];
  if (opts.permissionMode !== "bypassPermissions") {
    const hookScript = path.join(pkgRoot, "dist", "scripts", "hook.js");
    const sessionId = opts.env?.SNA_SESSION_ID ?? "default";
    preToolUseHooks.push({
      type: "command",
      command: `node "${hookScript}" --session=${sessionId}`,
      timeout: 300,
    });
    logger.log("agent", `codex: permission hook → ${hookScript} --session=${sessionId}`);
  }
  if (opts.allowedTools?.length || opts.disallowedTools?.length) {
    const filterScript = path.join(pkgRoot, "dist", "scripts", "tool-filter.js");
    const filterArgs: string[] = [];
    if (opts.allowedTools?.length) {
      filterArgs.push(`--allowed=${opts.allowedTools.join(",")}`);
    } else if (opts.disallowedTools?.length) {
      filterArgs.push(`--disallowed=${opts.disallowedTools.join(",")}`);
    }
    preToolUseHooks.push({
      type: "command",
      command: `node "${filterScript}" ${filterArgs.join(" ")}`,
    });
    logger.log("agent", `codex: tool-filter hook → ${opts.allowedTools ? `allowed=[${opts.allowedTools}]` : `disallowed=[${opts.disallowedTools}]`}`);
  }
  const consumerSettings = (opts.providerOptions as { settings?: Record<string, unknown> } | undefined)?.settings;
  const hooksJson = buildCodexHooksJson(preToolUseHooks, consumerSettings);
  if (hooksJson) {
    fs.writeFileSync(path.join(codexHome, "hooks.json"), JSON.stringify(hooksJson));
    const existingConfig = fs.existsSync(configTomlPath) ? fs.readFileSync(configTomlPath, "utf8") : "";
    if (!existingConfig.includes("codex_hooks")) {
      fs.appendFileSync(configTomlPath, "\n[features]\ncodex_hooks = true\n");
    }
  }
}

export function buildCodexHooksJson(
  internalHooks: CodexHookEntry[],
  appSettings?: Record<string, unknown> | undefined,
): CodexHooksJson | null {
  const matchers: CodexHookMatcher[] = [];
  if (internalHooks.length > 0) {
    matchers.push({ matcher: ".*", hooks: internalHooks });
  }

  if (appSettings && typeof appSettings === "object") {
    const appHooks = (appSettings as { hooks?: unknown }).hooks;
    if (appHooks && typeof appHooks === "object") {
      const appPreToolUse = (appHooks as { PreToolUse?: unknown }).PreToolUse;
      if (Array.isArray(appPreToolUse)) {
        for (const entry of appPreToolUse) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as { matcher?: unknown }).matcher === "string" &&
            Array.isArray((entry as { hooks?: unknown }).hooks)
          ) {
            matchers.push(entry as CodexHookMatcher);
          }
        }
      }
    }
  }

  if (matchers.length === 0) return null;
  return { hooks: { PreToolUse: matchers } };
}

function rpcRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest & { id: number } {
  return { method, id: ++rpcIdCounter, params: params ?? {} };
}

function rpcNotification(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { method, params: params ?? {} };
}

// ── CodexProcess ────────────────────────────────────────────────────────────

/**
 * Persistent Codex process using `codex app-server` (JSON-RPC over stdio).
 *
 * Lifecycle:
 * 1. spawn `codex app-server`
 * 2. send `initialize` request → wait for response
 * 3. send `initialized` notification
 * 4. send `thread/start` request → get threadId
 * 5. send `turn/start` with initial prompt (if provided)
 * 6. subsequent send() calls → `turn/start` with new input
 *
 * Codex notifications are normalized into AgentEvent and emitted.
 */
class CodexProcess implements AgentProcess {
  private emitter = new EventEmitter();
  private proc: ChildProcess;
  private _alive = true;
  private _sessionId: string | null = null;
  private _threadId: string | null = null;
  private _initEmitted = false;
  private buffer = "";
  private pendingResponses = new Map<number, (result: any) => void>();
  /**
   * Maps permission requestId → the JSON-RPC server request that raised it.
   * We remember the `method` because each approval kind wants a distinct
   * response shape (decision vs action vs permissions object) and the field
   * names differ — one-size-fits-all response writes would send the wrong
   * JSON and Codex silently interprets that as "decline" (observed live:
   * MCP tool calls always appearing as "user rejected").
   */
  private pendingServerRequests = new Map<string, { rpcId: number; method: string }>();
  private _ready = false;
  private _pendingSend: (() => void)[] = [];
  /** Set when interrupt() is called — causes queue to fast-drain delta events. */
  private _interrupted = false;
  /** Model override — applied on next turn/start. */
  private _modelOverride: string | null = null;
  /** Sandbox override — applied on next turn/start. */
  private _sandboxOverride: string | null = null;
  /** Working-directory override — applied on next turn/start. */
  private _cwdOverride: string | null = null;
  /** Set after the interrupted event is emitted — prevents duplicate. */
  private _interruptedEmitted = false;
  /** Current active turnId — needed for turn/interrupt. */
  private _currentTurnId: string | null = null;
  /** Active threadId — needed for thread/close. */
  private _activeThreadId: string | null = null;

  /** Accumulated token usage from tokenUsage/updated notifications. */
  private _lastUsage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null = null;

  /** FIFO event queue for ordered emission. */
  private eventQueue: AgentEvent[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly DRAIN_INTERVAL_MS = 15;

  private enqueue(event: AgentEvent): void {
    // After interrupt: drop queued deltas and emit terminal events immediately
    if (this._interrupted) {
      if (event.type === "assistant_delta" || event.type === "thinking_delta") return;
      // Terminal events (interrupted, complete, error, assistant) — emit directly
      this.emitter.emit("event", event);
      if (event.type === "interrupted" || event.type === "complete") {
        this._interrupted = false;
        // Discard remaining queued deltas
        this.eventQueue = this.eventQueue.filter(
          e => e.type !== "assistant_delta" && e.type !== "thinking_delta"
        );
        this.flushQueue();
      }
      return;
    }

    this.eventQueue.push(event);
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.drainOne(), CodexProcess.DRAIN_INTERVAL_MS);
    }
  }

  private drainOne(): void {
    const event = this.eventQueue.shift();
    if (event) this.emitter.emit("event", event);
    if (this.eventQueue.length === 0 && this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private flushQueue(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    while (this.eventQueue.length > 0) {
      this.emitter.emit("event", this.eventQueue.shift()!);
    }
  }

  get alive() { return this._alive; }
  get pid() { return this.proc.pid ?? null; }
  get sessionId() { return this._sessionId; }

  constructor(proc: ChildProcess, private options: SpawnOptions, private pooled: boolean = false) {
    this.proc = proc;

    proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        logger.log("stdout", line.slice(0, 300));
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch { /* non-JSON */ }
      }
    });

    proc.stderr!.on("data", () => { /* debug output — ignore */ });

    proc.on("exit", (code) => {
      this._alive = false;
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer);
          this.handleMessage(msg);
        } catch { /* ignore */ }
      }
      this.flushQueue();
      this.emitter.emit("exit", code);
      logger.log("agent", `codex process exited (code=${code})`);
    });

    proc.on("error", (err) => {
      this._alive = false;
      this.emitter.emit("error", err);
    });

    // For pooled daemons, prepareRuntime() already did the initialize
    // handshake, so we skip straight to thread start/resume.
    this.bootstrapThread();
  }

  // ── JSON-RPC communication ──────────────────────────────────────────────

  private write(msg: JsonRpcRequest): void {
    if (!this._alive || !this.proc.stdin!.writable) return;
    const line = JSON.stringify(msg);
    logger.log("stdin", line.slice(0, 200));
    this.proc.stdin!.write(line + "\n");
  }

  private sendRpc(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve) => {
      const req = rpcRequest(method, params);
      this.pendingResponses.set(req.id, resolve);
      this.write(req);
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    this.write(rpcNotification(method, params));
  }

  private handleMessage(msg: any): void {
    // Response to our request (has id + result/error, no method)
    if (msg.id != null && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
      const handler = this.pendingResponses.get(msg.id);
      if (handler) {
        this.pendingResponses.delete(msg.id);
        if (msg.error) {
          handler({ _error: true, ...msg.error });
        } else {
          handler(msg.result);
        }
      }
      return;
    }

    // Server request — Codex asking us for a decision (has method + id, no result)
    // e.g. item/commandExecution/requestApproval, item/fileChange/requestApproval
    if (msg.method && msg.id != null) {
      this.handleServerRequest(msg.method, msg.id, msg.params ?? {});
      return;
    }

    // Notification (has method, no id)
    if (msg.method) {
      const event = this.normalizeNotification(msg.method, msg.params ?? {});
      if (event) this.enqueue(event);
      return;
    }
  }

  /**
   * Handle a JSON-RPC server request (Codex asking the client for a decision).
   * Stores the (rpcId, method) so we can later respond with the correct
   * per-method schema via respondToPermission().
   *
   * Recognized methods:
   *   item/commandExecution/requestApproval — shell command gate (decision enum)
   *   item/fileChange/requestApproval       — file write gate (decision enum)
   *   item/permissions/requestApproval      — session permission grant (permissions profile)
   *   mcpServer/elicitation/request         — MCP tool / elicitation (action enum)
   *
   * When the session is in bypassPermissions mode we auto-accept every
   * request without routing to the UI — the user has already granted blanket
   * approval via that mode. This matches Loom's default guard level (which
   * runs bypassPermissions because tool policy is enforced via Loom's own
   * guard hook, not Codex's per-call approval UI).
   */
  private handleServerRequest(method: string, rpcId: number, params: any): void {
    // Filter: only process server requests for our thread (pooled daemon safety)
    const reqThreadId = params?.threadId ?? params?.thread?.id ?? params?.thread_id;
    if (reqThreadId && this._threadId && reqThreadId !== this._threadId) {
      // Auto-respond with empty result so the daemon unblocks, but don't
      // store in our pendingServerRequests (that belongs to another thread).
      this.write({ id: rpcId, result: {} } as any);
      return;
    }
    const isCommandApproval = method === "item/commandExecution/requestApproval";
    const isFileApproval = method === "item/fileChange/requestApproval";
    const isPermissionsApproval = method === "item/permissions/requestApproval";
    const isMcpElicitation = method === "mcpServer/elicitation/request";

    if (!isCommandApproval && !isFileApproval && !isPermissionsApproval && !isMcpElicitation) {
      // Unknown server request — auto-respond with empty result so Codex unblocks.
      logger.log("agent", `codex unknown server request: ${method} (id=${rpcId})`);
      this.write({ id: rpcId, result: {} } as any);
      return;
    }

    const requestId = params.itemId ?? params.id ?? `perm-${rpcId}`;
    this.pendingServerRequests.set(requestId, { rpcId, method });

    // Fast path: bypassPermissions auto-approves without UI round-trip.
    if (this.options.permissionMode === "bypassPermissions") {
      this.respondToPermission(requestId, true);
      return;
    }

    let message: string;
    let toolName: string;
    if (isMcpElicitation) {
      const serverName = params.serverName ?? "mcp";
      const toolDesc = params._meta?.tool_description ?? params.request?.message ?? "tool call";
      message = `MCP (${serverName}): ${toolDesc}`;
      toolName = `mcp:${serverName}`;
    } else if (isPermissionsApproval) {
      message = `Permissions: ${params.reason ?? "requested"}`;
      toolName = "permissions";
    } else if (isFileApproval) {
      message = `File change: ${params.path ?? "unknown"}`;
      toolName = "file_change";
    } else {
      message = `Command: ${params.command ?? "unknown"}`;
      toolName = "shell";
    }

    this.enqueue({
      type: "permission_needed",
      message,
      data: {
        requestId,
        toolName,
        method,
        command: params.command,
        path: params.path,
        serverName: params.serverName,
        reason: params.reason,
        itemId: params.itemId,
      },
      timestamp: Date.now(),
    });
  }

  // ── Initialization handshake ────────────────────────────────────────────

  /**
   * Run the JSON-RPC handshake (when needed) and start or resume a thread.
   *
   * Pooled mode skips the `initialize`/`initialized` handshake — the shared
   * daemon was already initialized during `prepareRuntime()`. The thread
   * start/resume logic (history injection, extraArgs fallbacks, sandbox /
   * model / instructions) is identical for both modes.
   */
  private async bootstrapThread(): Promise<void> {
    const where = this.pooled ? " on pooled daemon" : "";
    try {
      if (!this.pooled) {
        // Step 1: initialize request
        await this.sendRpc("initialize", {
          clientInfo: { name: "sna", title: "SNA SDK", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        });
        // Step 2: initialized notification
        this.sendNotification("initialized");
      }

      // Step 3: start or resume thread.
      // Typed fields take precedence; extraArgs is a fallback for backward compat.
      const resumeInfo = extractResumeArg(this.options.extraArgs);
      const resumeThreadId = this.options.resumeSessionId ?? resumeInfo?.threadId;
      const extraArgPrompts = extractSystemPromptArgs(
        resumeInfo ? resumeInfo.cleanArgs : this.options.extraArgs,
      );

      const baseInstructions = this.options.systemPrompt ?? extraArgPrompts.baseInstructions;
      const developerInstructions = this.options.appendSystemPrompt ?? extraArgPrompts.developerInstructions;

      const sandbox = toCodexSandbox(this.options.permissionMode);

      const threadParams: Record<string, unknown> = {
        sandbox,
        // `ThreadStartParams.cwd` lets a shared app-server daemon host threads
        // operating on different working directories. Without this every cwd
        // would need its own daemon; with it, one daemon serves all sessions.
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        ...(this.options.model ? { model: this.options.model } : {}),
        ...(baseInstructions ? { baseInstructions } : {}),
        ...(developerInstructions ? { developerInstructions } : {}),
      };

      // If cross-provider history was injected (no Codex threadId but history present),
      // use thread/resume with the experimental `history` field. This gets real
      // multi-turn context into the thread without synthesizing a fake user turn.
      const hasInjectedHistory = !resumeThreadId && (this.options.history?.length ?? 0) > 0;
      if (hasInjectedHistory) {
        // Enable the experimental feature (silently ignored if unavailable).
        try {
          await this.sendRpc("experimentalFeature/enablement/set", {
            enablement: { "thread/resume.history": true },
          });
        } catch (err) {
          logger.log("agent", `codex: failed to enable thread/resume.history feature: ${err}`);
        }
        const sessionId = this.options.env?.SNA_SESSION_ID ?? "default";
        const responseItems = canonicalToCodexResponseItems(this.options.history!, sessionId);
        const syntheticThreadId = crypto.randomUUID();
        const resumeResult = await this.sendRpc("thread/resume", {
          threadId: syntheticThreadId,
          history: responseItems,
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
          ...(baseInstructions ? { baseInstructions } : {}),
          ...(developerInstructions ? { developerInstructions } : {}),
          ...(this.options.model ? { model: this.options.model } : {}),
          sandbox,
        });
        if (resumeResult?._error) {
          // Experimental feature unavailable — fall back to fresh thread.
          // History is lost but we don't pollute the chat with fake turns.
          logger.log("agent", `codex: thread/resume with history failed${where} (${resumeResult.message ?? "unknown"}); falling back to fresh thread (history dropped)`);
          const threadResult = await this.sendRpc("thread/start", threadParams);
          this._threadId = threadResult?.threadId ?? threadResult?.thread?.id ?? null;
        } else {
          this._threadId = resumeResult?.thread?.id ?? syntheticThreadId;
          logger.log("agent", `codex: injected ${this.options.history!.length} history messages via thread/resume${where} (thread=${this._threadId})`);
        }
      } else if (resumeThreadId) {
        const resumeResult = await this.sendRpc("thread/resume", {
          threadId: resumeThreadId,
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
          ...(baseInstructions ? { baseInstructions } : {}),
          ...(developerInstructions ? { developerInstructions } : {}),
        });
        if (resumeResult?._error) {
          logger.log("agent", `codex: resume failed${where} (${resumeResult.message ?? "unknown"}), starting new thread`);
          const threadResult = await this.sendRpc("thread/start", threadParams);
          this._threadId = threadResult?.threadId ?? threadResult?.thread?.id ?? null;
        } else {
          this._threadId = resumeResult?.thread?.id ?? resumeThreadId;
          logger.log("agent", `codex: resumed thread ${this._threadId}${where}`);
        }
      } else {
        const threadResult = await this.sendRpc("thread/start", threadParams);
        this._threadId = threadResult?.threadId ?? threadResult?.thread?.id ?? null;
        if (this.pooled) {
          logger.log("agent", `codex: created thread ${this._threadId}${where}`);
        }
      }

      this._sessionId = this._threadId;
      this._activeThreadId = this._threadId;
      this._ready = true;

      if (!this._initEmitted) {
        this._initEmitted = true;
        this.enqueue({
          type: "init",
          message: `Codex ready (thread=${this._threadId}${this.pooled ? ", pooled" : ""})`,
          data: {
            sessionId: this._threadId,
            provider: "codex",
            ...(this.pooled ? { pooled: true } : {}),
          },
          timestamp: Date.now(),
        });
      }

      // Send initial prompt if provided. When cross-provider history was injected
      // above, we intentionally do NOT synthesize a fake "Continue..." turn —
      // the agent sits idle until the real user's next input, preserving the
      // illusion that the conversation continues naturally across runtimes.
      if (this.options.prompt) {
        this.startTurn(this.options.prompt);
      }

      // Drain any messages queued while initializing
      for (const fn of this._pendingSend) fn();
      this._pendingSend = [];
    } catch (err) {
      const phase = this.pooled ? "thread start" : "init";
      logger.err("agent", `codex ${phase}${where} failed:`, err);
      this.enqueue({
        type: "error",
        message: this.pooled
          ? `Codex thread start failed: ${err}`
          : `Codex initialization failed: ${err}`,
        timestamp: Date.now(),
      });
    }
  }

  private startTurn(input: string | ContentBlock[]): void {
    if (!this._threadId) return;

    // NOTE: we intentionally do NOT emit a synthetic `user_message` event here.
    // SNA's /send route already broadcasts user_message to listeners before
    // calling this, so a provider-side emission would double-fire — the UI
    // would render the user's bubble twice and visibly flicker as it dedupes.
    // The initial-prompt case (options.prompt passed through spawn) reaches
    // here without a prior /send broadcast, but the UI displays that message
    // from the chat_messages row already persisted at /start time, so no
    // additional event is needed for rendering.

    // Codex app-server input content block format:
    //   text:  { type: "text", text: "..." }
    //   image: { type: "image", url: "data:<mime>;base64,<data>" }
    const contentBlocks = typeof input === "string"
      ? [{ type: "text" as const, text: input }]
      : input.map(b => {
          if (b.type === "text") return { type: "text" as const, text: b.text };
          // Convert Anthropic base64 format to Codex data URL format
          const src = b.source;
          const url = `data:${src.media_type};base64,${src.data}`;
          return { type: "image" as const, url };
        });

    const turnParams: Record<string, unknown> = {
      threadId: this._threadId,
      input: contentBlocks,
    };
    // Apply per-turn overrides (become new thread defaults)
    if (this._modelOverride) {
      turnParams.model = this._modelOverride;
      logger.log("agent", `codex: turn/start with model=${this._modelOverride}`);
      this._modelOverride = null;
    }
    if (this._sandboxOverride) {
      turnParams.sandboxPolicy = toCodexSandboxPolicy(this._sandboxOverride);
      logger.log("agent", `codex: turn/start with sandboxPolicy=${turnParams.sandboxPolicy}`);
      this._sandboxOverride = null;
    }
    if (this._cwdOverride) {
      // TurnStartParams.cwd is "for this turn and subsequent turns" per the
      // codex app-server schema — sticky once set, so we only emit it on the
      // turn where applyPatch landed.
      turnParams.cwd = this._cwdOverride;
      logger.log("agent", `codex: turn/start with cwd=${this._cwdOverride}`);
      this._cwdOverride = null;
    }

    this.sendRpc("turn/start", turnParams).then((result) => {
      // Capture turnId for interrupt
      if (result?.turn?.id) this._currentTurnId = result.turn.id;
    }).catch((err) => {
      logger.err("agent", "turn/start failed:", err);
    });
  }

  // ── Public AgentProcess API ─────────────────────────────────────────────

  send(input: string | ContentBlock[]): void {
    if (!this._alive) return;
    if (!this._ready) {
      this._pendingSend.push(() => this.startTurn(input));
      return;
    }
    this.startTurn(input);
  }

  interrupt(): void {
    if (!this._alive || !this._threadId) return;
    this._interrupted = true;
    const params: Record<string, string> = { threadId: this._threadId };
    if (this._currentTurnId) params.turnId = this._currentTurnId;
    this.sendRpc("turn/interrupt", params).then((result) => {
      logger.log("agent", `codex: turn/interrupt response: ${JSON.stringify(result).slice(0, 300)}`);
      // Emit interrupted event from the response.
      this._interruptedEmitted = true;
      this.enqueue({
        type: "interrupted",
        message: "Turn interrupted by user",
        data: {
          durationMs: result?.turn?.durationMs ?? result?.durationMs,
          provider: "codex",
        },
        timestamp: Date.now(),
      });
    }).catch((err) => {
      logger.err("agent", `codex: turn/interrupt failed:`, err);
      // Still emit interrupted so the UI knows
      this.enqueue({
        type: "interrupted",
        message: "Turn interrupted",
        data: { provider: "codex" },
        timestamp: Date.now(),
      });
    });
  }

  setModel(model: string): void {
    // Codex supports per-turn model override via turn/start params.
    // Store it and apply on the next turn.
    this._modelOverride = model;
    logger.log("agent", `codex: model override set → ${model} (applied on next turn)`);
  }

  setPermissionMode(mode: string): void {
    // Codex supports per-turn sandbox override via turn/start params.
    this._sandboxOverride = mode;
    logger.log("agent", `codex: sandbox override set → ${mode} (applied on next turn)`);
  }

  applyPatch(patch: import("./types.js").SessionPatch): import("./types.js").SessionPatch {
    // codex app-server's TurnStartParams accepts `cwd`, `model`, and
    // `sandboxPolicy` overrides that take effect on the next turn and stay
    // sticky thereafter. Every currently-declared SessionPatch field maps
    // cleanly into a queued override, so applyPatch never has any leftover.
    if (patch.model !== undefined) this.setModel(patch.model);
    if (patch.permissionMode !== undefined) this.setPermissionMode(patch.permissionMode);
    if (patch.cwd !== undefined) {
      this._cwdOverride = patch.cwd;
      logger.log("agent", `codex: cwd override set → ${patch.cwd} (applied on next turn)`);
    }
    return {};
  }

  /**
   * Respond to a pending permission request from Codex.
   * Sends JSON-RPC response back via stdin to approve/deny the tool execution.
   */
  /**
   * Respond to a pending permission request from Codex via JSON-RPC stdin.
   *
   * Each server-request method expects a distinct response schema (the field
   * names and the enum values differ between command/file approvals, MCP
   * elicitation, and generic permission grants). Sending the wrong shape
   * looks like success to the SDK but Codex silently interprets it as
   * "decline" — which is how MCP tool calls started showing up as
   * "user rejected" even under bypassPermissions.
   */
  respondToPermission(requestId: string, approved: boolean): void {
    const pending = this.pendingServerRequests.get(requestId);
    if (!pending) {
      logger.log("agent", `codex: no pending server request for ${requestId}`);
      return;
    }
    this.pendingServerRequests.delete(requestId);
    const { rpcId, method } = pending;

    let result: Record<string, unknown>;
    switch (method) {
      case "mcpServer/elicitation/request":
        // McpServerElicitationRequestResponse — { action, content, _meta }
        result = {
          action: approved ? "accept" : "decline",
          content: null,
          _meta: null,
        };
        break;
      case "item/permissions/requestApproval":
        // PermissionsRequestApprovalResponse — empty grant on decline, requested profile on approve.
        // Since we don't currently track the requested profile client-side, we echo an empty
        // permissions object with "turn" scope; Codex treats that as a minimal grant.
        result = { permissions: {}, scope: "turn" };
        break;
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      default:
        // { decision: "accept" | "decline" } (plus "acceptForSession" variants for richer UX later)
        result = { decision: approved ? "accept" : "decline" };
        break;
    }

    this.write({ id: rpcId, result } as any);
    logger.log(
      "agent",
      `codex: permission ${approved ? "accept" : "decline"} (method=${method}, rpcId=${rpcId}, requestId=${requestId})`,
    );
  }

  /**
   * Close only the active thread on a pooled daemon (does NOT kill the daemon).
   * Called when a session ends but the shared app-server should persist.
   */
  closeThread(): void {
    if (!this._alive) return;
    if (!this.pooled) {
      // Non-pooled: nothing to close, just kill the process
      this._alive = false;
      this.proc.kill("SIGTERM");
      return;
    }
    // Pooled: close the active thread, keep the daemon alive
    this._alive = false;
    const threadId = this._activeThreadId ?? this._threadId;
    if (threadId) {
      this.sendRpc("thread/close", { threadId }).catch((err) => {
        logger.err("agent", `codex: thread/close failed:`, err);
      });
      logger.log("agent", `codex: closed thread ${threadId} on pooled daemon`);
    }
  }

  kill(): void {
    if (this._alive) {
      this._alive = false;
      if (this.pooled) {
        // Pooled mode: only close the thread, keep the daemon alive
        this.closeThread();
      } else {
        // Non-pooled: kill the entire process
        this.proc.kill("SIGTERM");
      }
    }
  }

  on(event: string, handler: Function): void {
    this.emitter.on(event, handler as any);
  }

  off(event: string, handler: Function): void {
    this.emitter.off(event, handler as any);
  }

  // ── Event normalization ─────────────────────────────────────────────────

  private normalizeNotification(method: string, params: any): AgentEvent | null {
    // Filter: only process events for our thread (pooled daemon safety)
    const eventThreadId = params?.thread?.id ?? params?.threadId ?? params?.thread_id;
    if (eventThreadId && this._threadId && eventThreadId !== this._threadId) {
      return null; // Event for another thread — skip
    }
    switch (method) {
      // ── Thread lifecycle ─────────────────────────────────────────────
      case "thread/started":
        // Already handled during init, but update threadId if needed
        if (params.thread?.id) this._threadId = params.thread.id;
        return null;

      case "thread/closed":
      case "thread/archived":
        return null;

      // ── Turn lifecycle ───────────────────────────────────────────────
      case "turn/started":
        // Capture turnId for interrupt; reset interrupt flags for new turn
        if (params.turn?.id) this._currentTurnId = params.turn.id;
        this._interrupted = false;
        this._interruptedEmitted = false;
        return null;

      case "turn/completed": {
        this._currentTurnId = null;
        const turn = params.turn ?? params;
        // Deduplicate: if interrupted was already emitted from turn/interrupt response, skip
        if (turn.status === "interrupted" && this._interruptedEmitted) {
          this._interruptedEmitted = false;
          this._lastUsage = null;
          return null;
        }
        const usage = this._lastUsage ?? {};
        const event: AgentEvent = {
          type: turn.status === "interrupted" ? "interrupted" : "complete",
          message: turn.status === "failed" ? (turn.error?.message ?? "Turn failed") : "Done",
          data: {
            durationMs: turn.durationMs ?? turn.duration_ms,
            inputTokens: (usage as any).inputTokens ?? 0,
            outputTokens: (usage as any).outputTokens ?? 0,
            cacheReadTokens: (usage as any).cachedInputTokens ?? 0,
            provider: "codex",
          },
          timestamp: Date.now(),
        };
        this._lastUsage = null;
        return event;
      }

      // ── Item events ──────────────────────────────────────────────────
      case "item/started": {
        const item = params.item ?? params;
        return this.normalizeItemStarted(item);
      }

      case "item/completed": {
        const item = params.item ?? params;
        return this.normalizeItemCompleted(item);
      }

      // ── Streaming deltas ─────────────────────────────────────────────
      case "item/agentMessage/delta":
        return {
          type: "assistant_delta",
          delta: params.delta ?? params.text ?? "",
          index: 0,
          timestamp: Date.now(),
        };

      case "item/reasoning/summaryTextDelta":
        return {
          type: "thinking_delta",
          message: params.delta ?? params.text ?? "",
          timestamp: Date.now(),
        };

      case "item/commandExecution/outputDelta":
        // Command output streaming — emit as tool_use update
        return {
          type: "tool_use",
          message: "shell",
          data: {
            toolName: "shell",
            id: params.itemId,
            outputDelta: params.delta,
            update: true,
          },
          timestamp: Date.now(),
        };

      // ── Approval requests (fallback for notifications without id) ───
      // Server requests (with id) are handled in handleServerRequest().
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        return null; // handled as server request

      case "item/fileChange/outputDelta":
        return null; // patch output — skip

      // ── Token usage tracking ─────────────────────────────────────────
      case "thread/tokenUsage/updated": {
        // Prefer "last" (per-turn) over "total" (cumulative)
        const usage = params.tokenUsage ?? {};
        const tu = usage.last ?? usage.total ?? {};
        this._lastUsage = {
          inputTokens: tu.inputTokens ?? tu.input_tokens ?? 0,
          outputTokens: tu.outputTokens ?? tu.output_tokens ?? 0,
          cachedInputTokens: tu.cachedInputTokens ?? tu.cached_input_tokens ?? 0,
        };
        return null;
      }

      // ── Informational (no-op) ──────────────────────────────────────────
      case "turn/diff/updated":
      case "turn/plan/updated":
      case "thread/name/updated":
      case "thread/status/changed":
      case "model/rerouted":
      case "skills/changed":
      case "mcpServer/startupStatus/updated":
      case "account/rateLimits/updated":
        return null;

      // ── Error ────────────────────────────────────────────────────────
      case "error":
        return {
          type: "error",
          message: params.message ?? params.error ?? "Unknown codex error",
          timestamp: Date.now(),
        };

      default:
        logger.log("agent", `codex unhandled notification: ${method}`, JSON.stringify(params).substring(0, 200));
        return null;
    }
  }

  private normalizeItemStarted(item: any): AgentEvent | null {
    switch (item.type) {
      case "command_execution":
      case "commandExecution":
        return {
          type: "tool_use",
          message: "shell",
          data: {
            toolName: "shell",
            id: item.id,
            command: item.command,
            streaming: true,
          },
          timestamp: Date.now(),
        };

      case "file_change":
      case "fileChange":
        return {
          type: "tool_use",
          message: "file_change",
          data: {
            toolName: "file_change",
            id: item.id,
            changes: item.changes,
            streaming: true,
          },
          timestamp: Date.now(),
        };

      case "mcp_tool_call":
      case "mcpToolCall":
        return {
          type: "tool_use",
          message: `${item.server}:${item.tool}`,
          data: {
            toolName: `${item.server}:${item.tool}`,
            id: item.id,
            input: item.arguments,
            streaming: true,
          },
          timestamp: Date.now(),
        };

      case "web_search":
      case "webSearch":
        return {
          type: "tool_use",
          message: "web_search",
          data: { toolName: "web_search", id: item.id, query: item.query },
          timestamp: Date.now(),
        };

      case "userMessage":
      case "user_message":
        return null; // echo of user input — skip

      default:
        return null;
    }
  }

  private normalizeItemCompleted(item: any): AgentEvent | null {
    switch (item.type) {
      case "agent_message":
      case "agentMessage":
        return {
          type: "assistant",
          message: item.text ?? "",
          timestamp: Date.now(),
        };

      case "reasoning":
        return {
          type: "thinking",
          message: item.text ?? "",
          timestamp: Date.now(),
        };

      case "command_execution":
      case "commandExecution":
        return {
          type: "tool_result",
          message: item.aggregated_output ?? item.aggregatedOutput ?? "",
          data: {
            toolName: "shell",
            id: item.id,
            exitCode: item.exit_code ?? item.exitCode,
            status: item.status,
            isError: item.status === "failed" || item.status === "declined",
          },
          timestamp: Date.now(),
        };

      case "file_change":
      case "fileChange":
        return {
          type: "tool_result",
          message: `File changes ${item.status}`,
          data: {
            toolName: "file_change",
            id: item.id,
            changes: item.changes,
            status: item.status,
            isError: item.status === "failed",
          },
          timestamp: Date.now(),
        };

      case "mcp_tool_call":
      case "mcpToolCall":
        return {
          type: "tool_result",
          message: item.result
            ? JSON.stringify(item.result).slice(0, 500)
            : (item.error?.message ?? ""),
          data: {
            toolName: `${item.server}:${item.tool}`,
            id: item.id,
            isError: !!item.error || item.status === "failed",
          },
          timestamp: Date.now(),
        };

      case "web_search":
      case "webSearch":
        return {
          type: "tool_result",
          message: "Web search completed",
          data: { toolName: "web_search", id: item.id },
          timestamp: Date.now(),
        };

      case "todo_list":
      case "todoList":
        return null; // internal tracking

      case "error":
        return {
          type: "error",
          message: item.message ?? "Item error",
          timestamp: Date.now(),
        };

      default:
        return null;
    }
  }
}

// ── CodexProvider ────────────────────────────────────────────────────────────

export class CodexProvider implements AgentProvider {
  readonly name = "codex";
  readonly supportsRuntimePooling = true; // Daemon-style: app-server pool
  // codex app-server's `ThreadStartParams.cwd`, `ThreadResumeParams.cwd`, and
  // `TurnStartParams.cwd` let each thread/turn carry its own working directory,
  // so one shared daemon can host sessions operating on different cwds.
  readonly supportsCwdPerThread = true;

  async isAvailable(): Promise<boolean> {
    try {
      const result = resolveCodexCli();
      if (result.source === "fallback") return false;
      return result.version != null;
    } catch {
      return false;
    }
  }

  async complete(options: CompleteOptions): Promise<CompletionResult> {
    const cwd = options.cwd ?? process.cwd();
    const resolved = resolveCodexCli();
    const codexPath = resolved.path;

    const args = ["exec", "--json", "--ephemeral", "--full-auto"];

    if (options.model) args.push("--model", options.model);
    if (options.extraArgs) args.push(...options.extraArgs);

    const instructions = [options.systemPrompt, options.appendSystemPrompt].filter(Boolean).join("\n\n");
    if (instructions) {
      args.push("-c", `developer_instructions=${JSON.stringify(instructions)}`);
    }

    args.push(options.prompt);

    const cleanEnv = { ...process.env, ...options.env } as Record<string, string>;
    const codexDir = path.dirname(codexPath);
    if (codexDir && codexDir !== ".") {
      cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
    }

    const timeout = options.timeout ?? 60_000;
    const model = options.model ?? "codex-default";

    logger.log("agent", `complete: provider=codex model=${model} prompt="${options.prompt.slice(0, 60)}..."`);

    const startTime = Date.now();

    return new Promise<CompletionResult>((resolve, reject) => {
      const proc = spawn(codexPath, args, {
        cwd,
        env: cleanEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`complete timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`complete spawn error: ${err.message}`));
      });

      proc.stdin!.end();

      proc.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        const lines = stdout.trim().split("\n").filter(l => l.trim());
        const events: Array<{
          type: string;
          item?: { type: string; text?: string; id?: string };
          usage?: { input_tokens: number; cached_input_tokens: number; output_tokens: number };
          error?: { message: string };
        }> = [];
        for (const line of lines) {
          try { events.push(JSON.parse(line)); } catch { /* skip */ }
        }

        let text = "";
        for (const evt of events) {
          if (evt.type === "item.completed" && evt.item?.type === "agent_message") {
            text = evt.item.text ?? "";
          }
        }

        let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
        for (const evt of events) {
          if (evt.type === "turn.completed" && evt.usage) {
            usage = evt.usage;
          }
        }

        const errorEvent = events.find(e => e.type === "turn.failed" || e.type === "error");
        if (errorEvent) {
          reject(new Error(`complete error: ${errorEvent.error?.message ?? "unknown"}`));
          return;
        }

        if (!text && code !== 0) {
          reject(new Error(`complete: codex exited with code ${code}: ${stderr.slice(0, 200)}`));
          return;
        }

        resolve({
          text,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cached_input_tokens,
            cacheCreationTokens: 0,
          },
          costUsd: 0,
          durationMs,
          durationApiMs: durationMs,
          model,
        });
      });
    });
  }

  // ── Runtime pooling (daemon-style) ──────────────────────────────────

  /**
   * Prepare a global Codex app-server runtime.
   *
   * Lifecycle:
   *   1. Spawn `codex app-server` (single daemon process)
   *   2. Initialize JSON-RPC handshake (initialize → initialized)
   *   3. Return a RuntimeHandle with the daemon process
   *
   * Multiple sessions share this single daemon; each session gets its
   * own thread via thread/start on top of the shared app-server.
   *
   * Per-session hooks (permissions, tool filters) are written to the
   * CODEX_HOME on a per-session basis — the daemon itself is shared.
   * The CODEX_HOME is keyed by configDir or cwd for isolation.
   */
  async prepareRuntime(config: import("./runtime.js").RuntimeConfig): Promise<import("./runtime.js").RuntimeHandle> {
    const codexPath = resolveCodexPath(config.cwd);
    const codexParts = codexPath.split(/\s+/);
    const codexBinary = codexParts[0]!;
    const codexPrefix = codexParts.slice(1);

    // Each runtime config gets its own CODEX_HOME for hook/config isolation
    const codexHome = config.configDir ?? path.join(config.cwd, ".sna", "codex-home");
    if (!fs.existsSync(codexHome)) {
      fs.mkdirSync(codexHome, { recursive: true });
    }

    // Copy auth credentials from real ~/.codex if not already present
    const realCodexHome = `${process.env.HOME}/.codex`;
    for (const f of ["auth.json", "installation_id"]) {
      const src = path.join(realCodexHome, f);
      const dst = path.join(codexHome, f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
    const configTomlPath = path.join(codexHome, "config.toml");
    if (!fs.existsSync(configTomlPath)) {
      const realConfig = path.join(realCodexHome, "config.toml");
      if (fs.existsSync(realConfig)) {
        fs.copyFileSync(realConfig, configTomlPath);
      }
    }

    const cleanEnv: Record<string, string> = { ...process.env, ...config.env } as Record<string, string>;
    cleanEnv.CODEX_HOME = codexHome;

    // Ensure codex binary dir is in PATH
    const codexDir = path.dirname(codexBinary);
    if (codexDir && codexDir !== ".") {
      cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
    }

    // MCP servers + hooks must be in CODEX_HOME *before* the daemon spawns,
    // otherwise the pooled daemon boots without consumer tooling — tool calls
    // (loom-tools, etc.) silently fall through to "command not found" inside
    // the agent. The non-pooled spawn path already does this; we duplicate the
    // call here for the pool path through the shared applyCodexConfig helper.
    let pkgRoot = path.dirname(fileURLToPath(import.meta.url));
    while (!fs.existsSync(path.join(pkgRoot, "package.json"))) {
      const parent = path.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    applyCodexConfig(codexHome, {
      mcpServers: config.mcp as Record<string, McpServerConfig> | undefined,
      allowedTools: config.settings?.allowedTools,
      disallowedTools: config.settings?.disallowedTools,
      permissionMode: config.permissionMode,
      providerOptions: config.providerOptions,
      env: config.env,
    }, pkgRoot);

    logger.log("agent", `codex: preparing runtime (CODEX_HOME=${codexHome})`);

    // Spawn the app-server daemon
    const daemon = spawn(codexBinary, [...codexPrefix, "app-server"], {
      cwd: config.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Health check: send a JSON-RPC `initialize` request and wait for the
    // matching response. The daemon doesn't volunteer a ready signal — until
    // initialize completes, threads on this daemon would hang. The original
    // version of this code waited for a response without sending the request,
    // so the pooled path was effectively dormant; production traffic only ever
    // hit the legacy non-pooled spawn fallback.
    let daemonReady = false;
    const readyTimeout = setTimeout(() => {
      if (!daemonReady) {
        logger.err("agent", "codex: runtime prepare timed out waiting for initialize response");
        daemon.kill("SIGTERM");
      }
    }, 10_000);

    // JSON-RPC id for the initialize request — needs to be a number we can
    // recognize in the response stream so we don't mistake unrelated server
    // notifications for the init ack.
    const initializeId = 0;

    // Buffer to collect stdout for JSON-RPC parsing
    let stdoutBuffer = "";

    return new Promise<import("./runtime.js").RuntimeHandle>((resolve, reject) => {
      const onStdout = (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            // Match the response to our initialize id specifically.
            if (msg.id === initializeId && !msg.method && msg.result !== undefined) {
              if (!daemonReady) {
                daemonReady = true;
                clearTimeout(readyTimeout);
                logger.log("agent", `codex: runtime daemon ready (pid=${daemon.pid})`);
                // Per the JSON-RPC convention codex uses, follow the response
                // with an `initialized` notification before any thread/start.
                try {
                  daemon.stdin!.write(JSON.stringify({
                    jsonrpc: "2.0",
                    method: "initialized",
                  }) + "\n");
                } catch { /* already dead — caught below */ }
                // Detach our listeners so the CodexProcess thread wrappers
                // see clean event flow and we don't keep buffering stdout in
                // this closure forever.
                daemon.stdout!.off("data", onStdout);
                daemon.stderr!.off("data", onStderr);
                resolve({
                  provider: this.name,
                  ready: true,
                  daemon,
                  activeThreadCount: 0,
                  dispose: () => {
                    try { daemon.kill("SIGTERM"); } catch { /* already dead */ }
                  },
                });
              }
            }
          } catch { /* non-JSON, ignore */ }
        }
      };
      const onStderr = (buf: Buffer) => {
        // Surface stderr at debug volume — codex emits non-fatal warnings
        // here, but a real crash leaves a useful trace.
        const txt = buf.toString().trim();
        if (txt) logger.log("agent", `codex daemon stderr: ${txt.slice(0, 500)}`);
      };

      daemon.stdout!.on("data", onStdout);
      daemon.stderr!.on("data", onStderr);

      daemon.on("error", (err) => {
        clearTimeout(readyTimeout);
        reject(new Error(`codex runtime prepare failed: ${err.message}`));
      });

      daemon.on("exit", (code) => {
        clearTimeout(readyTimeout);
        if (!daemonReady) {
          reject(new Error(`codex runtime daemon exited with code ${code}`));
        }
      });

      // Send the initialize request now that the listeners are wired up.
      try {
        daemon.stdin!.write(JSON.stringify({
          jsonrpc: "2.0",
          id: initializeId,
          method: "initialize",
          params: {
            clientInfo: { name: "sna", title: "SNA SDK", version: "1.0.0" },
            capabilities: { experimentalApi: true },
          },
        }) + "\n");
      } catch (err: any) {
        clearTimeout(readyTimeout);
        reject(new Error(`codex runtime initialize write failed: ${err?.message ?? err}`));
      }
    });
  }

  spawn(options: SpawnOptions, runtimeHandle?: import("./runtime.js").RuntimeHandle): AgentProcess {
    // If a runtime handle was provided (daemon pooled), reuse it.
    // Otherwise spawn a new app-server (legacy path, e.g. for run-once).
    if (runtimeHandle && runtimeHandle.daemon) {
      const daemon = runtimeHandle.daemon as ChildProcess;
      logger.log("agent", `codex: using pooled runtime (pid=${daemon.pid}), spawning thread`);
      return new CodexProcess(daemon, options, true /* pooled */);
    }

    // Legacy path: spawn a new app-server (no pooling)
    const codexPath = resolveCodexPath(options.cwd);

    const args = ["app-server"];

    const cleanEnv = { ...process.env, ...options.env } as Record<string, string>;

    // ── CODEX_HOME setup ──────────────────────────────────────────────
    // Always create a CODEX_HOME to inject hooks.json and config.
    // Use configDir if provided, otherwise create a temp dir under .sna/.
    const codexHome = options.configDir ?? path.join(options.cwd, ".sna", "codex-home");
    if (!fs.existsSync(codexHome)) {
      fs.mkdirSync(codexHome, { recursive: true });
    }

    // Copy auth credentials from real ~/.codex if not already present
    const realCodexHome = `${process.env.HOME}/.codex`;
    for (const f of ["auth.json", "installation_id"]) {
      const src = path.join(realCodexHome, f);
      const dst = path.join(codexHome, f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
    // Copy config.toml (will be appended to below)
    const configTomlPath = path.join(codexHome, "config.toml");
    if (!fs.existsSync(configTomlPath)) {
      const realConfig = path.join(realCodexHome, "config.toml");
      if (fs.existsSync(realConfig)) {
        fs.copyFileSync(realConfig, configTomlPath);
      }
    }

    cleanEnv.CODEX_HOME = codexHome;

    // MCP servers + hooks. Shared with prepareRuntime via applyCodexConfig
    // so pooled and non-pooled CODEX_HOMEs are configured identically.
    let pkgRoot = path.dirname(fileURLToPath(import.meta.url));
    while (!fs.existsSync(path.join(pkgRoot, "package.json"))) {
      const parent = path.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    applyCodexConfig(codexHome, {
      mcpServers: options.mcpServers,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      permissionMode: options.permissionMode,
      providerOptions: options.providerOptions,
      env: options.env,
    }, pkgRoot);

    logger.log("agent", `codex: CODEX_HOME=${codexHome}`);

    // Ensure codex binary dir is in PATH
    const codexDir = path.dirname(codexPath);
    if (codexDir && codexDir !== ".") {
      cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
    }

    // Strip flags handled internally by CodexProcess:
    //   --resume → thread/resume API
    //   --system-prompt / --append-system-prompt → thread/start baseInstructions/developerInstructions
    const resumeInfo = extractResumeArg(options.extraArgs);
    const sysInfo = extractSystemPromptArgs(resumeInfo ? resumeInfo.cleanArgs : options.extraArgs);
    if (sysInfo.cleanArgs.length) {
      args.push(...sysInfo.cleanArgs);
    }

    const proc = spawn(codexPath, args, {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    logger.log("agent", `spawned codex app-server (pid=${proc.pid}) → ${codexPath} ${args.join(" ")}`);

    return new CodexProcess(proc, options);
  }

  /**
   * List Codex (OpenAI) models. Calls `codex debug models` which returns the
   * raw model catalog as JSON — kept fresh by the CLI itself, so we don't
   * have to ship a stale static list. We filter to `visibility === "list"`
   * (hides internal models like `codex-auto-review`) and to entries that
   * declare `supported_in_api === true`.
   *
   * Falls back to the curated static catalog if the CLI isn't reachable
   * (CLI not installed, child-process failure, malformed output). The
   * fallback's `error` field surfaces the underlying reason.
   */
  async listModels(config?: ListModelsConfig): Promise<ListModelsResult> {
    return listCodexModels(config?.cliPath, config?.refresh);
  }
}

const CODEX_STATIC_MODELS: RuntimeModelInfo[] = [
  { id: "gpt-5.4",         label: "GPT-5.4",         provider: "openai", source: "static" },
  { id: "gpt-5.4-mini",    label: "GPT-5.4 Mini",    provider: "openai", source: "static" },
  { id: "gpt-5.3-codex",   label: "GPT-5.3 Codex",   provider: "openai", source: "static" },
  { id: "gpt-5.2",         label: "GPT-5.2",         provider: "openai", source: "static" },
];

const codexModelsCache = new Map<string, { result: ListModelsResult; expiresAt: number }>();
const CODEX_MODELS_TTL_MS = 5 * 60_000;

function staticCodexFallback(error?: string): ListModelsResult {
  return {
    models: CODEX_STATIC_MODELS.slice(),
    source: "static",
    fetchedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

/**
 * Parse `codex debug models` JSON output into the canonical RuntimeModelInfo
 * shape. Exported for unit testing — the actual CLI invocation is shelled
 * out in {@link listCodexModels} and uses this parser on the captured stdout.
 */
export function parseCodexModelsOutput(stdout: string): RuntimeModelInfo[] {
  if (!stdout || !stdout.trim()) return [];
  let parsed: any;
  try { parsed = JSON.parse(stdout); }
  catch { return []; }

  const models: any[] = Array.isArray(parsed?.models) ? parsed.models : [];
  const out: RuntimeModelInfo[] = [];
  for (const m of models) {
    if (!m || typeof m.slug !== "string" || !m.slug) continue;
    if (m.visibility && m.visibility !== "list") continue;
    if (m.supported_in_api === false) continue;
    out.push({
      id: m.slug,
      label: typeof m.display_name === "string" && m.display_name ? m.display_name : m.slug,
      provider: "openai",
      source: "cli",
      ...(typeof m.description === "string" && m.description ? { notes: m.description } : {}),
    });
  }
  return out;
}

async function listCodexModels(cliPathOverride?: string, refresh?: boolean): Promise<ListModelsResult> {
  let cliPath = cliPathOverride;
  if (!cliPath) {
    const resolved = resolveCodexCli();
    // resolveCodexCli always returns a path; treat the "fallback" source
    // (PATH lookup) as best-effort — the execSync below will surface
    // ENOENT if it isn't actually on PATH and we'll fall back to static.
    cliPath = resolved.path;
  }
  if (!cliPath) {
    return staticCodexFallback("codex CLI not found — using static catalog");
  }

  const cacheKey = cliPath;
  if (!refresh) {
    const hit = codexModelsCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.result;
  }

  try {
    const codexDir = path.dirname(cliPath);
    const env = { ...process.env, PATH: `${codexDir}:${process.env.PATH ?? ""}` };
    const stdout = execSync(`"${cliPath}" debug models`, {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, env,
      maxBuffer: 10 * 1024 * 1024,
    });
    const models = parseCodexModelsOutput(stdout);
    if (models.length === 0) {
      return staticCodexFallback("codex debug models returned no entries — using static catalog");
    }
    const result: ListModelsResult = {
      models,
      source: "cli",
      fetchedAt: Date.now(),
    };
    codexModelsCache.set(cacheKey, { result, expiresAt: Date.now() + CODEX_MODELS_TTL_MS });
    return result;
  } catch (e: any) {
    return staticCodexFallback(`codex debug models failed: ${e?.message ?? e}`);
  }
}
