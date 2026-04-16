import { spawn, execSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AgentProvider, AgentProcess, AgentEvent, SpawnOptions, ContentBlock, HistoryMessage } from "./types.js";
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

function toCodexSandbox(mode?: string): string {
  switch (mode) {
    case "bypassPermissions": return "danger-full-access";
    case "acceptEdits": return "workspace-write";
    default: return "read-only";
  }
}

// ── History context builder ──────────────────────────────────────────────────

/**
 * Pack conversation history into a context prefix for the first user message.
 * Codex doesn't support synthetic history injection like Claude Code's JSONL resume,
 * so we prepend it as structured context that the model can reference.
 */
function buildHistoryContext(history: HistoryMessage[]): string {
  const turns = history.map((msg) =>
    `<${msg.role}>\n${msg.content}\n</${msg.role}>`
  ).join("\n\n");
  return `<conversation-history>\nThe following is our previous conversation. Use it as context.\n\n${turns}\n</conversation-history>\n\n`;
}

/**
 * Extract --resume <threadId> from extraArgs.
 * Returns the threadId and cleaned args, or null if not found.
 */
function extractResumeArg(extraArgs?: string[]): { threadId: string; cleanArgs: string[] } | null {
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
function extractSystemPromptArgs(extraArgs?: string[]): {
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
  /** Maps permission requestId → JSON-RPC server request id for approval responses. */
  private pendingServerRequests = new Map<string, number>();
  private _ready = false;
  private _pendingSend: (() => void)[] = [];
  /** Set when interrupt() is called — causes queue to fast-drain delta events. */
  private _interrupted = false;
  /** Set after the interrupted event is emitted — prevents duplicate. */
  private _interruptedEmitted = false;
  /** Current active turnId — needed for turn/interrupt. */
  private _currentTurnId: string | null = null;

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

  constructor(proc: ChildProcess, private options: SpawnOptions) {
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

    // Start initialization handshake
    this.initialize();
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
   * Stores the rpcId so we can respond later via respondToPermission().
   */
  private handleServerRequest(method: string, rpcId: number, params: any): void {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      const requestId = params.itemId ?? params.id ?? `perm-${rpcId}`;
      this.pendingServerRequests.set(requestId, rpcId);

      const isFileChange = method.includes("fileChange");
      this.enqueue({
        type: "permission_needed",
        message: isFileChange
          ? `File change: ${params.path ?? "unknown"}`
          : `Command: ${params.command ?? "unknown"}`,
        data: {
          requestId,
          toolName: isFileChange ? "file_change" : "shell",
          command: params.command,
          path: params.path,
          itemId: params.itemId,
        },
        timestamp: Date.now(),
      });
      return;
    }

    // Unknown server request — auto-respond with empty result
    logger.log("agent", `codex unknown server request: ${method} (id=${rpcId})`);
    this.write({ id: rpcId, result: {} } as any);
  }

  // ── Initialization handshake ────────────────────────────────────────────

  private async initialize(): Promise<void> {
    try {
      // Step 1: initialize request
      await this.sendRpc("initialize", {
        clientInfo: { name: "sna", title: "SNA SDK", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });

      // Step 2: initialized notification
      this.sendNotification("initialized");

      // Step 3: start or resume thread
      const resumeInfo = extractResumeArg(this.options.extraArgs);
      const sysPrompt = extractSystemPromptArgs(
        resumeInfo ? resumeInfo.cleanArgs : this.options.extraArgs,
      );

      const sandbox = toCodexSandbox(this.options.permissionMode);

      // Common thread params for instructions
      const threadParams: Record<string, unknown> = {
        sandbox,
        ...(this.options.model ? { model: this.options.model } : {}),
        ...(sysPrompt.baseInstructions ? { baseInstructions: sysPrompt.baseInstructions } : {}),
        ...(sysPrompt.developerInstructions ? { developerInstructions: sysPrompt.developerInstructions } : {}),
      };

      if (resumeInfo?.threadId) {
        // Try to resume existing Codex thread by ID
        const resumeResult = await this.sendRpc("thread/resume", {
          threadId: resumeInfo.threadId,
          ...(sysPrompt.baseInstructions ? { baseInstructions: sysPrompt.baseInstructions } : {}),
          ...(sysPrompt.developerInstructions ? { developerInstructions: sysPrompt.developerInstructions } : {}),
        });
        if (resumeResult?._error) {
          logger.log("agent", `codex: resume failed (${resumeResult.message ?? "unknown"}), starting new thread`);
          const threadResult = await this.sendRpc("thread/start", threadParams);
          this._threadId = threadResult?.threadId ?? threadResult?.thread?.id ?? null;
        } else {
          this._threadId = resumeResult?.thread?.id ?? resumeInfo.threadId;
          logger.log("agent", `codex: resumed thread ${this._threadId}`);
        }
      } else {
        const threadResult = await this.sendRpc("thread/start", threadParams);
        this._threadId = threadResult?.threadId ?? threadResult?.thread?.id ?? null;
      }

      this._sessionId = this._threadId;
      this._ready = true;

      if (!this._initEmitted) {
        this._initEmitted = true;
        this.enqueue({
          type: "init",
          message: `Codex ready (thread=${this._threadId})`,
          data: { sessionId: this._threadId, provider: "codex" },
          timestamp: Date.now(),
        });
      }

      // Build prompt with optional history context prefix
      let prompt = this.options.prompt;
      if (this.options.history?.length && prompt) {
        // Prepend conversation history as context
        const context = buildHistoryContext(this.options.history);
        prompt = context + prompt;
        logger.log("agent", `codex: injected ${this.options.history.length} history messages as context`);
      } else if (this.options.history?.length && !prompt) {
        // History without prompt — inject history and let agent wait
        const context = buildHistoryContext(this.options.history);
        prompt = context + "Continue from where we left off. What would you like to do next?";
        logger.log("agent", `codex: injected ${this.options.history.length} history messages (no prompt)`);
      }

      // Send initial prompt if provided
      if (prompt) {
        this.startTurn(prompt);
      }

      // Drain any messages queued while initializing
      for (const fn of this._pendingSend) fn();
      this._pendingSend = [];
    } catch (err) {
      logger.err("agent", `codex init failed:`, err);
      this.enqueue({
        type: "error",
        message: `Codex initialization failed: ${err}`,
        timestamp: Date.now(),
      });
    }
  }

  private startTurn(input: string | ContentBlock[]): void {
    if (!this._threadId) return;

    // Emit user_message event so Langfuse tracer can start a new turn
    const userText = typeof input === "string"
      ? input
      : input.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("\n");
    this.enqueue({
      type: "user_message",
      message: userText,
      timestamp: Date.now(),
    });

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

    this.sendRpc("turn/start", {
      threadId: this._threadId,
      input: contentBlocks,
    }).then((result) => {
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

  setModel(_model: string): void {
    // Codex doesn't support runtime model change on existing thread.
    // Model is set at thread creation. Log and ignore.
    logger.log("agent", "codex: setModel ignored (set at thread creation)");
  }

  setPermissionMode(_mode: string): void {
    // Codex sandbox mode is set at thread creation.
    logger.log("agent", "codex: setPermissionMode ignored (set at thread creation)");
  }

  /**
   * Respond to a pending permission request from Codex.
   * Sends JSON-RPC response back via stdin to approve/deny the tool execution.
   */
  /**
   * Respond to a pending permission request from Codex.
   * Codex expects: { id, result: { decision: "accept"|"decline" } }
   */
  respondToPermission(requestId: string, approved: boolean): void {
    const rpcId = this.pendingServerRequests.get(requestId);
    if (rpcId == null) {
      logger.log("agent", `codex: no pending server request for ${requestId}`);
      return;
    }
    this.pendingServerRequests.delete(requestId);
    const decision = approved ? "accept" : "decline";
    this.write({ id: rpcId, result: { decision } } as any);
    logger.log("agent", `codex: permission ${decision} (rpcId=${rpcId}, requestId=${requestId})`);
  }

  kill(): void {
    if (this._alive) {
      this._alive = false;
      this.proc.kill("SIGTERM");
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

  async isAvailable(): Promise<boolean> {
    try {
      const result = resolveCodexCli();
      if (result.source === "fallback") return false;
      return result.version != null;
    } catch {
      return false;
    }
  }

  spawn(options: SpawnOptions): AgentProcess {
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

    // ── Hook injection (same pattern as ClaudeCodeProvider) ───────────
    // Skip when bypassPermissions — all tools auto-allowed.
    if (options.permissionMode !== "bypassPermissions") {
      // Resolve hook script path
      let pkgRoot = path.dirname(fileURLToPath(import.meta.url));
      while (!fs.existsSync(path.join(pkgRoot, "package.json"))) {
        const parent = path.dirname(pkgRoot);
        if (parent === pkgRoot) break;
        pkgRoot = parent;
      }
      const hookScript = path.join(pkgRoot, "dist", "scripts", "hook.js");
      const sessionId = options.env?.SNA_SESSION_ID ?? "default";

      // Write hooks.json
      const hooksJson = {
        hooks: {
          PreToolUse: [{
            matcher: ".*",
            hooks: [{
              type: "command",
              command: `node "${hookScript}" --session=${sessionId}`,
              timeout: 300,
            }],
          }],
        },
      };
      fs.writeFileSync(path.join(codexHome, "hooks.json"), JSON.stringify(hooksJson));

      // Enable codex_hooks feature in config.toml
      const existingConfig = fs.readFileSync(configTomlPath, "utf8");
      if (!existingConfig.includes("codex_hooks")) {
        fs.appendFileSync(configTomlPath, "\n[features]\ncodex_hooks = true\n");
      }

      logger.log("agent", `codex: hooks injected → ${hookScript} --session=${sessionId}`);
    }

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
}
