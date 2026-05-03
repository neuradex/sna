import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalToCodexResponseItems } from "../../history/codex.js";
import { logger } from "../../lib/logger.js";
const SHELL = process.env.SHELL || "/bin/zsh";
function validateCodexPath(codexPath) {
  try {
    const codexDir = path.dirname(codexPath);
    const env = { ...process.env, PATH: `${codexDir}:${process.env.PATH ?? ""}` };
    const out = execSync(`"${codexPath}" --version`, {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 1e4,
      env
    }).trim();
    return { ok: true, version: out.split("\n")[0].slice(0, 50) };
  } catch {
    return { ok: false };
  }
}
function cacheCodexPath(codexPath, cacheDir) {
  const dir = cacheDir ?? path.join(process.cwd(), ".sna");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "codex-path"), codexPath);
  } catch {
  }
}
function resolveCodexCli(opts) {
  const cacheDir = opts?.cacheDir;
  if (process.env.SNA_CODEX_COMMAND) {
    const v = validateCodexPath(process.env.SNA_CODEX_COMMAND);
    return { path: process.env.SNA_CODEX_COMMAND, version: v.version, source: "env" };
  }
  const cacheFile = cacheDir ? path.join(cacheDir, "codex-path") : path.join(process.cwd(), ".sna/codex-path");
  try {
    const cached = fs.readFileSync(cacheFile, "utf8").trim();
    if (cached) {
      const v = validateCodexPath(cached);
      if (v.ok) return { path: cached, version: v.version, source: "cache" };
    }
  } catch {
  }
  const staticPaths = [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    `${process.env.HOME}/.local/bin/codex`,
    `${process.env.HOME}/.cargo/bin/codex`,
    `${process.env.HOME}/.codex/bin/codex`
  ];
  for (const p of staticPaths) {
    const v = validateCodexPath(p);
    if (v.ok) {
      cacheCodexPath(p, cacheDir);
      return { path: p, version: v.version, source: "static" };
    }
  }
  try {
    const raw = execSync(`${SHELL} -i -l -c "command -v codex" 2>/dev/null`, {
      encoding: "utf8",
      timeout: 5e3
    }).trim();
    if (raw && raw !== "codex" && raw.startsWith("/")) {
      const v = validateCodexPath(raw);
      if (v.ok) {
        cacheCodexPath(raw, cacheDir);
        return { path: raw, version: v.version, source: "shell" };
      }
    }
  } catch {
  }
  return { path: "codex", source: "fallback" };
}
function resolveCodexPath(cwd) {
  const result = resolveCodexCli({ cacheDir: path.join(cwd, ".sna") });
  logger.log("agent", `codex path: ${result.source}=${result.path}${result.version ? ` (${result.version})` : ""}`);
  return result.path;
}
function toCodexSandbox(mode) {
  switch (mode) {
    case "bypassPermissions":
      return "danger-full-access";
    case "acceptEdits":
      return "workspace-write";
    default:
      return "read-only";
  }
}
function toCodexSandboxPolicy(mode) {
  switch (mode) {
    case "bypassPermissions":
      return "dangerFullAccess";
    case "acceptEdits":
      return "workspaceWrite";
    default:
      return "readOnly";
  }
}
function extractResumeArg(extraArgs) {
  if (!extraArgs) return null;
  const idx = extraArgs.indexOf("--resume");
  if (idx === -1) return null;
  const threadId = extraArgs[idx + 1];
  if (!threadId || threadId.startsWith("--")) return null;
  const cleanArgs = [...extraArgs];
  cleanArgs.splice(idx, 2);
  return { threadId, cleanArgs };
}
function extractSystemPromptArgs(extraArgs) {
  if (!extraArgs) return { cleanArgs: [] };
  const cleanArgs = [...extraArgs];
  let baseInstructions;
  let developerInstructions;
  const sysIdx = cleanArgs.indexOf("--system-prompt");
  if (sysIdx !== -1 && sysIdx + 1 < cleanArgs.length) {
    baseInstructions = cleanArgs[sysIdx + 1];
    cleanArgs.splice(sysIdx, 2);
  }
  const appendIdx = cleanArgs.indexOf("--append-system-prompt");
  if (appendIdx !== -1 && appendIdx + 1 < cleanArgs.length) {
    developerInstructions = cleanArgs[appendIdx + 1];
    cleanArgs.splice(appendIdx, 2);
  }
  return { baseInstructions, developerInstructions, cleanArgs };
}
let rpcIdCounter = 0;
function rpcRequest(method, params) {
  return { method, id: ++rpcIdCounter, params: params ?? {} };
}
function rpcNotification(method, params) {
  return { method, params: params ?? {} };
}
const _CodexProcess = class _CodexProcess {
  constructor(proc, options) {
    this.options = options;
    this.emitter = new EventEmitter();
    this._alive = true;
    this._sessionId = null;
    this._threadId = null;
    this._initEmitted = false;
    this.buffer = "";
    this.pendingResponses = /* @__PURE__ */ new Map();
    /**
     * Maps permission requestId → the JSON-RPC server request that raised it.
     * We remember the `method` because each approval kind wants a distinct
     * response shape (decision vs action vs permissions object) and the field
     * names differ — one-size-fits-all response writes would send the wrong
     * JSON and Codex silently interprets that as "decline" (observed live:
     * MCP tool calls always appearing as "user rejected").
     */
    this.pendingServerRequests = /* @__PURE__ */ new Map();
    this._ready = false;
    this._pendingSend = [];
    /** Set when interrupt() is called — causes queue to fast-drain delta events. */
    this._interrupted = false;
    /** Model override — applied on next turn/start. */
    this._modelOverride = null;
    /** Sandbox override — applied on next turn/start. */
    this._sandboxOverride = null;
    /** Set after the interrupted event is emitted — prevents duplicate. */
    this._interruptedEmitted = false;
    /** Current active turnId — needed for turn/interrupt. */
    this._currentTurnId = null;
    /** Accumulated token usage from tokenUsage/updated notifications. */
    this._lastUsage = null;
    /** FIFO event queue for ordered emission. */
    this.eventQueue = [];
    this.drainTimer = null;
    this.proc = proc;
    proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        logger.log("stdout", line.slice(0, 300));
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch {
        }
      }
    });
    proc.stderr.on("data", () => {
    });
    proc.on("exit", (code) => {
      this._alive = false;
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer);
          this.handleMessage(msg);
        } catch {
        }
      }
      this.flushQueue();
      this.emitter.emit("exit", code);
      logger.log("agent", `codex process exited (code=${code})`);
    });
    proc.on("error", (err) => {
      this._alive = false;
      this.emitter.emit("error", err);
    });
    this.initialize();
  }
  enqueue(event) {
    if (this._interrupted) {
      if (event.type === "assistant_delta" || event.type === "thinking_delta") return;
      this.emitter.emit("event", event);
      if (event.type === "interrupted" || event.type === "complete") {
        this._interrupted = false;
        this.eventQueue = this.eventQueue.filter(
          (e) => e.type !== "assistant_delta" && e.type !== "thinking_delta"
        );
        this.flushQueue();
      }
      return;
    }
    this.eventQueue.push(event);
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.drainOne(), _CodexProcess.DRAIN_INTERVAL_MS);
    }
  }
  drainOne() {
    const event = this.eventQueue.shift();
    if (event) this.emitter.emit("event", event);
    if (this.eventQueue.length === 0 && this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }
  flushQueue() {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    while (this.eventQueue.length > 0) {
      this.emitter.emit("event", this.eventQueue.shift());
    }
  }
  get alive() {
    return this._alive;
  }
  get pid() {
    return this.proc.pid ?? null;
  }
  get sessionId() {
    return this._sessionId;
  }
  // ── JSON-RPC communication ──────────────────────────────────────────────
  write(msg) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const line = JSON.stringify(msg);
    logger.log("stdin", line.slice(0, 200));
    this.proc.stdin.write(line + "\n");
  }
  sendRpc(method, params) {
    return new Promise((resolve) => {
      const req = rpcRequest(method, params);
      this.pendingResponses.set(req.id, resolve);
      this.write(req);
    });
  }
  sendNotification(method, params) {
    this.write(rpcNotification(method, params));
  }
  handleMessage(msg) {
    if (msg.id != null && !msg.method && (msg.result !== void 0 || msg.error !== void 0)) {
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
    if (msg.method && msg.id != null) {
      this.handleServerRequest(msg.method, msg.id, msg.params ?? {});
      return;
    }
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
  handleServerRequest(method, rpcId, params) {
    const isCommandApproval = method === "item/commandExecution/requestApproval";
    const isFileApproval = method === "item/fileChange/requestApproval";
    const isPermissionsApproval = method === "item/permissions/requestApproval";
    const isMcpElicitation = method === "mcpServer/elicitation/request";
    if (!isCommandApproval && !isFileApproval && !isPermissionsApproval && !isMcpElicitation) {
      logger.log("agent", `codex unknown server request: ${method} (id=${rpcId})`);
      this.write({ id: rpcId, result: {} });
      return;
    }
    const requestId = params.itemId ?? params.id ?? `perm-${rpcId}`;
    this.pendingServerRequests.set(requestId, { rpcId, method });
    if (this.options.permissionMode === "bypassPermissions") {
      this.respondToPermission(requestId, true);
      return;
    }
    let message;
    let toolName;
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
        itemId: params.itemId
      },
      timestamp: Date.now()
    });
  }
  // ── Initialization handshake ────────────────────────────────────────────
  async initialize() {
    try {
      await this.sendRpc("initialize", {
        clientInfo: { name: "sna", title: "SNA SDK", version: "1.0.0" },
        capabilities: { experimentalApi: true }
      });
      this.sendNotification("initialized");
      const resumeInfo = extractResumeArg(this.options.extraArgs);
      const resumeThreadId = this.options.resumeSessionId ?? resumeInfo?.threadId;
      const extraArgPrompts = extractSystemPromptArgs(
        resumeInfo ? resumeInfo.cleanArgs : this.options.extraArgs
      );
      const baseInstructions = this.options.systemPrompt ?? extraArgPrompts.baseInstructions;
      const developerInstructions = this.options.appendSystemPrompt ?? extraArgPrompts.developerInstructions;
      const sandbox = toCodexSandbox(this.options.permissionMode);
      const threadParams = {
        sandbox,
        ...this.options.model ? { model: this.options.model } : {},
        ...baseInstructions ? { baseInstructions } : {},
        ...developerInstructions ? { developerInstructions } : {}
      };
      const hasInjectedHistory = !resumeThreadId && (this.options.history?.length ?? 0) > 0;
      if (hasInjectedHistory) {
        try {
          await this.sendRpc("experimentalFeature/enablement/set", {
            enablement: { "thread/resume.history": true }
          });
        } catch (err) {
          logger.log("agent", `codex: failed to enable thread/resume.history feature: ${err}`);
        }
        const sessionId = this.options.env?.SNA_SESSION_ID ?? "default";
        const responseItems = canonicalToCodexResponseItems(this.options.history, sessionId);
        const syntheticThreadId = crypto.randomUUID();
        const resumeResult = await this.sendRpc("thread/resume", {
          threadId: syntheticThreadId,
          history: responseItems,
          ...baseInstructions ? { baseInstructions } : {},
          ...developerInstructions ? { developerInstructions } : {},
          ...this.options.model ? { model: this.options.model } : {},
          sandbox
        });
        if (resumeResult?._error) {
          logger.log("agent", `codex: thread/resume with history failed (${resumeResult.message ?? "unknown"}); falling back to fresh thread (history dropped)`);
          const threadResult = await this.sendRpc("thread/start", threadParams);
          this._threadId = threadResult?.threadId ?? threadResult?.thread?.id ?? null;
        } else {
          this._threadId = resumeResult?.thread?.id ?? syntheticThreadId;
          logger.log("agent", `codex: injected ${this.options.history.length} history messages via thread/resume (thread=${this._threadId})`);
        }
      } else if (resumeThreadId) {
        const resumeResult = await this.sendRpc("thread/resume", {
          threadId: resumeThreadId,
          ...baseInstructions ? { baseInstructions } : {},
          ...developerInstructions ? { developerInstructions } : {}
        });
        if (resumeResult?._error) {
          logger.log("agent", `codex: resume failed (${resumeResult.message ?? "unknown"}), starting new thread`);
          const threadResult = await this.sendRpc("thread/start", threadParams);
          this._threadId = threadResult?.threadId ?? threadResult?.thread?.id ?? null;
        } else {
          this._threadId = resumeResult?.thread?.id ?? resumeThreadId;
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
          timestamp: Date.now()
        });
      }
      if (this.options.prompt) {
        this.startTurn(this.options.prompt);
      }
      for (const fn of this._pendingSend) fn();
      this._pendingSend = [];
    } catch (err) {
      logger.err("agent", `codex init failed:`, err);
      this.enqueue({
        type: "error",
        message: `Codex initialization failed: ${err}`,
        timestamp: Date.now()
      });
    }
  }
  startTurn(input) {
    if (!this._threadId) return;
    const contentBlocks = typeof input === "string" ? [{ type: "text", text: input }] : input.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text };
      const src = b.source;
      const url = `data:${src.media_type};base64,${src.data}`;
      return { type: "image", url };
    });
    const turnParams = {
      threadId: this._threadId,
      input: contentBlocks
    };
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
    this.sendRpc("turn/start", turnParams).then((result) => {
      if (result?.turn?.id) this._currentTurnId = result.turn.id;
    }).catch((err) => {
      logger.err("agent", "turn/start failed:", err);
    });
  }
  // ── Public AgentProcess API ─────────────────────────────────────────────
  send(input) {
    if (!this._alive) return;
    if (!this._ready) {
      this._pendingSend.push(() => this.startTurn(input));
      return;
    }
    this.startTurn(input);
  }
  interrupt() {
    if (!this._alive || !this._threadId) return;
    this._interrupted = true;
    const params = { threadId: this._threadId };
    if (this._currentTurnId) params.turnId = this._currentTurnId;
    this.sendRpc("turn/interrupt", params).then((result) => {
      logger.log("agent", `codex: turn/interrupt response: ${JSON.stringify(result).slice(0, 300)}`);
      this._interruptedEmitted = true;
      this.enqueue({
        type: "interrupted",
        message: "Turn interrupted by user",
        data: {
          durationMs: result?.turn?.durationMs ?? result?.durationMs,
          provider: "codex"
        },
        timestamp: Date.now()
      });
    }).catch((err) => {
      logger.err("agent", `codex: turn/interrupt failed:`, err);
      this.enqueue({
        type: "interrupted",
        message: "Turn interrupted",
        data: { provider: "codex" },
        timestamp: Date.now()
      });
    });
  }
  setModel(model) {
    this._modelOverride = model;
    logger.log("agent", `codex: model override set \u2192 ${model} (applied on next turn)`);
  }
  setPermissionMode(mode) {
    this._sandboxOverride = mode;
    logger.log("agent", `codex: sandbox override set \u2192 ${mode} (applied on next turn)`);
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
  respondToPermission(requestId, approved) {
    const pending = this.pendingServerRequests.get(requestId);
    if (!pending) {
      logger.log("agent", `codex: no pending server request for ${requestId}`);
      return;
    }
    this.pendingServerRequests.delete(requestId);
    const { rpcId, method } = pending;
    let result;
    switch (method) {
      case "mcpServer/elicitation/request":
        result = {
          action: approved ? "accept" : "decline",
          content: null,
          _meta: null
        };
        break;
      case "item/permissions/requestApproval":
        result = { permissions: {}, scope: "turn" };
        break;
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      default:
        result = { decision: approved ? "accept" : "decline" };
        break;
    }
    this.write({ id: rpcId, result });
    logger.log(
      "agent",
      `codex: permission ${approved ? "accept" : "decline"} (method=${method}, rpcId=${rpcId}, requestId=${requestId})`
    );
  }
  kill() {
    if (this._alive) {
      this._alive = false;
      this.proc.kill("SIGTERM");
    }
  }
  on(event, handler) {
    this.emitter.on(event, handler);
  }
  off(event, handler) {
    this.emitter.off(event, handler);
  }
  // ── Event normalization ─────────────────────────────────────────────────
  normalizeNotification(method, params) {
    switch (method) {
      // ── Thread lifecycle ─────────────────────────────────────────────
      case "thread/started":
        if (params.thread?.id) this._threadId = params.thread.id;
        return null;
      case "thread/closed":
      case "thread/archived":
        return null;
      // ── Turn lifecycle ───────────────────────────────────────────────
      case "turn/started":
        if (params.turn?.id) this._currentTurnId = params.turn.id;
        this._interrupted = false;
        this._interruptedEmitted = false;
        return null;
      case "turn/completed": {
        this._currentTurnId = null;
        const turn = params.turn ?? params;
        if (turn.status === "interrupted" && this._interruptedEmitted) {
          this._interruptedEmitted = false;
          this._lastUsage = null;
          return null;
        }
        const usage = this._lastUsage ?? {};
        const event = {
          type: turn.status === "interrupted" ? "interrupted" : "complete",
          message: turn.status === "failed" ? turn.error?.message ?? "Turn failed" : "Done",
          data: {
            durationMs: turn.durationMs ?? turn.duration_ms,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cacheReadTokens: usage.cachedInputTokens ?? 0,
            provider: "codex"
          },
          timestamp: Date.now()
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
          timestamp: Date.now()
        };
      case "item/reasoning/summaryTextDelta":
        return {
          type: "thinking_delta",
          message: params.delta ?? params.text ?? "",
          timestamp: Date.now()
        };
      case "item/commandExecution/outputDelta":
        return {
          type: "tool_use",
          message: "shell",
          data: {
            toolName: "shell",
            id: params.itemId,
            outputDelta: params.delta,
            update: true
          },
          timestamp: Date.now()
        };
      // ── Approval requests (fallback for notifications without id) ───
      // Server requests (with id) are handled in handleServerRequest().
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        return null;
      // handled as server request
      case "item/fileChange/outputDelta":
        return null;
      // patch output — skip
      // ── Token usage tracking ─────────────────────────────────────────
      case "thread/tokenUsage/updated": {
        const usage = params.tokenUsage ?? {};
        const tu = usage.last ?? usage.total ?? {};
        this._lastUsage = {
          inputTokens: tu.inputTokens ?? tu.input_tokens ?? 0,
          outputTokens: tu.outputTokens ?? tu.output_tokens ?? 0,
          cachedInputTokens: tu.cachedInputTokens ?? tu.cached_input_tokens ?? 0
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
          timestamp: Date.now()
        };
      default:
        logger.log("agent", `codex unhandled notification: ${method}`, JSON.stringify(params).substring(0, 200));
        return null;
    }
  }
  normalizeItemStarted(item) {
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
            streaming: true
          },
          timestamp: Date.now()
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
            streaming: true
          },
          timestamp: Date.now()
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
            streaming: true
          },
          timestamp: Date.now()
        };
      case "web_search":
      case "webSearch":
        return {
          type: "tool_use",
          message: "web_search",
          data: { toolName: "web_search", id: item.id, query: item.query },
          timestamp: Date.now()
        };
      case "userMessage":
      case "user_message":
        return null;
      // echo of user input — skip
      default:
        return null;
    }
  }
  normalizeItemCompleted(item) {
    switch (item.type) {
      case "agent_message":
      case "agentMessage":
        return {
          type: "assistant",
          message: item.text ?? "",
          timestamp: Date.now()
        };
      case "reasoning":
        return {
          type: "thinking",
          message: item.text ?? "",
          timestamp: Date.now()
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
            isError: item.status === "failed" || item.status === "declined"
          },
          timestamp: Date.now()
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
            isError: item.status === "failed"
          },
          timestamp: Date.now()
        };
      case "mcp_tool_call":
      case "mcpToolCall":
        return {
          type: "tool_result",
          message: item.result ? JSON.stringify(item.result).slice(0, 500) : item.error?.message ?? "",
          data: {
            toolName: `${item.server}:${item.tool}`,
            id: item.id,
            isError: !!item.error || item.status === "failed"
          },
          timestamp: Date.now()
        };
      case "web_search":
      case "webSearch":
        return {
          type: "tool_result",
          message: "Web search completed",
          data: { toolName: "web_search", id: item.id },
          timestamp: Date.now()
        };
      case "todo_list":
      case "todoList":
        return null;
      // internal tracking
      case "error":
        return {
          type: "error",
          message: item.message ?? "Item error",
          timestamp: Date.now()
        };
      default:
        return null;
    }
  }
};
_CodexProcess.DRAIN_INTERVAL_MS = 15;
let CodexProcess = _CodexProcess;
class CodexProvider {
  constructor() {
    this.name = "codex";
  }
  async isAvailable() {
    try {
      const result = resolveCodexCli();
      if (result.source === "fallback") return false;
      return result.version != null;
    } catch {
      return false;
    }
  }
  async complete(options) {
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
    const cleanEnv = { ...process.env, ...options.env };
    const codexDir = path.dirname(codexPath);
    if (codexDir && codexDir !== ".") {
      cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
    }
    const timeout = options.timeout ?? 6e4;
    const model = options.model ?? "codex-default";
    logger.log("agent", `complete: provider=codex model=${model} prompt="${options.prompt.slice(0, 60)}..."`);
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const proc = spawn(codexPath, args, {
        cwd,
        env: cleanEnv,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`complete timed out after ${timeout}ms`));
      }, timeout);
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`complete spawn error: ${err.message}`));
      });
      proc.stdin.end();
      proc.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const lines = stdout.trim().split("\n").filter((l) => l.trim());
        const events = [];
        for (const line of lines) {
          try {
            events.push(JSON.parse(line));
          } catch {
          }
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
        const errorEvent = events.find((e) => e.type === "turn.failed" || e.type === "error");
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
            cacheCreationTokens: 0
          },
          costUsd: 0,
          durationMs,
          durationApiMs: durationMs,
          model
        });
      });
    });
  }
  spawn(options) {
    const codexPath = resolveCodexPath(options.cwd);
    const args = ["app-server"];
    const cleanEnv = { ...process.env, ...options.env };
    const codexHome = options.configDir ?? path.join(options.cwd, ".sna", "codex-home");
    if (!fs.existsSync(codexHome)) {
      fs.mkdirSync(codexHome, { recursive: true });
    }
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
    cleanEnv.CODEX_HOME = codexHome;
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      const tomlLines = [];
      for (const [name, cfg] of Object.entries(options.mcpServers)) {
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
          if (cfg.args?.length) {
            tomlLines.push(`args = ${JSON.stringify(cfg.args)}`);
          }
          if (cfg.cwd) {
            tomlLines.push(`cwd = ${JSON.stringify(cfg.cwd)}`);
          }
          if (cfg.env && Object.keys(cfg.env).length > 0) {
            tomlLines.push(`[mcp_servers.${name}.env]`);
            for (const [k, v] of Object.entries(cfg.env)) {
              tomlLines.push(`${k} = ${JSON.stringify(v)}`);
            }
          }
        }
        tomlLines.push("");
      }
      fs.appendFileSync(configTomlPath, "\n" + tomlLines.join("\n"));
      logger.log("agent", `codex: ${Object.keys(options.mcpServers).length} MCP servers injected`);
    }
    let pkgRoot = path.dirname(fileURLToPath(import.meta.url));
    while (!fs.existsSync(path.join(pkgRoot, "package.json"))) {
      const parent = path.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const preToolUseHooks = [];
    if (options.permissionMode !== "bypassPermissions") {
      const hookScript = path.join(pkgRoot, "dist", "scripts", "hook.js");
      const sessionId = options.env?.SNA_SESSION_ID ?? "default";
      preToolUseHooks.push({
        type: "command",
        command: `node "${hookScript}" --session=${sessionId}`,
        timeout: 300
      });
      logger.log("agent", `codex: permission hook \u2192 ${hookScript} --session=${sessionId}`);
    }
    if (options.allowedTools?.length || options.disallowedTools?.length) {
      const filterScript = path.join(pkgRoot, "dist", "scripts", "tool-filter.js");
      const filterArgs = [];
      if (options.allowedTools?.length) {
        filterArgs.push(`--allowed=${options.allowedTools.join(",")}`);
      } else if (options.disallowedTools?.length) {
        filterArgs.push(`--disallowed=${options.disallowedTools.join(",")}`);
      }
      preToolUseHooks.push({
        type: "command",
        command: `node "${filterScript}" ${filterArgs.join(" ")}`
      });
      logger.log("agent", `codex: tool-filter hook \u2192 ${options.allowedTools ? `allowed=[${options.allowedTools}]` : `disallowed=[${options.disallowedTools}]`}`);
    }
    if (preToolUseHooks.length > 0) {
      const hooksJson = {
        hooks: {
          PreToolUse: [{
            matcher: ".*",
            hooks: preToolUseHooks
          }]
        }
      };
      fs.writeFileSync(path.join(codexHome, "hooks.json"), JSON.stringify(hooksJson));
      const existingConfig = fs.readFileSync(configTomlPath, "utf8");
      if (!existingConfig.includes("codex_hooks")) {
        fs.appendFileSync(configTomlPath, "\n[features]\ncodex_hooks = true\n");
      }
    }
    logger.log("agent", `codex: CODEX_HOME=${codexHome}`);
    const codexDir = path.dirname(codexPath);
    if (codexDir && codexDir !== ".") {
      cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
    }
    const resumeInfo = extractResumeArg(options.extraArgs);
    const sysInfo = extractSystemPromptArgs(resumeInfo ? resumeInfo.cleanArgs : options.extraArgs);
    if (sysInfo.cleanArgs.length) {
      args.push(...sysInfo.cleanArgs);
    }
    const proc = spawn(codexPath, args, {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    logger.log("agent", `spawned codex app-server (pid=${proc.pid}) \u2192 ${codexPath} ${args.join(" ")}`);
    return new CodexProcess(proc, options);
  }
}
export {
  CodexProvider,
  cacheCodexPath,
  extractResumeArg,
  extractSystemPromptArgs,
  resolveCodexCli,
  toCodexSandbox,
  validateCodexPath
};
