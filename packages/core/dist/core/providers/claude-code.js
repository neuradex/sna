import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { writeClaudeHistoryJsonl } from "../../history/claude-code.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "../../config.js";
const SHELL = process.env.SHELL || "/bin/zsh";
function parseCommandVOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "claude";
  const aliasMatch = trimmed.match(/=\s*['"]?([^'"]+?)['"]?\s*$/);
  if (aliasMatch) return aliasMatch[1];
  const pathMatch = trimmed.match(/^(\/\S+)/m);
  if (pathMatch) return pathMatch[1];
  return trimmed;
}
function validateClaudePath(claudePath) {
  try {
    const claudeDir = path.dirname(claudePath);
    const env = { ...process.env, PATH: `${claudeDir}:${process.env.PATH ?? ""}` };
    const out = execSync(`"${claudePath}" --version`, { encoding: "utf8", stdio: "pipe", timeout: 1e4, env }).trim();
    return { ok: true, version: out.split("\n")[0].slice(0, 30) };
  } catch {
    return { ok: false };
  }
}
function cacheClaudePath(claudePath, cacheDir) {
  const dir = cacheDir ?? path.join(process.cwd(), ".sna");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "claude-path"), claudePath);
  } catch {
  }
}
function resolveClaudeCli(opts) {
  const cacheDir = opts?.cacheDir;
  if (process.env.SNA_CLAUDE_COMMAND) {
    const v = validateClaudePath(process.env.SNA_CLAUDE_COMMAND);
    return { path: process.env.SNA_CLAUDE_COMMAND, version: v.version, source: "env" };
  }
  const cacheFile = cacheDir ? path.join(cacheDir, "claude-path") : path.join(process.cwd(), ".sna/claude-path");
  try {
    const cached = fs.readFileSync(cacheFile, "utf8").trim();
    if (cached) {
      const v = validateClaudePath(cached);
      if (v.ok) return { path: cached, version: v.version, source: "cache" };
    }
  } catch {
  }
  const staticPaths = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.claude/bin/claude`,
    `${process.env.HOME}/.volta/bin/claude`
  ];
  for (const p of staticPaths) {
    const v = validateClaudePath(p);
    if (v.ok) {
      cacheClaudePath(p, cacheDir);
      return { path: p, version: v.version, source: "static" };
    }
  }
  try {
    const raw = execSync(`${SHELL} -i -l -c "command -v claude" 2>/dev/null`, { encoding: "utf8", timeout: 5e3 }).trim();
    const resolved = parseCommandVOutput(raw);
    if (resolved && resolved !== "claude") {
      const v = validateClaudePath(resolved);
      if (v.ok) {
        cacheClaudePath(resolved, cacheDir);
        return { path: resolved, version: v.version, source: "shell" };
      }
    }
  } catch {
  }
  return { path: "claude", source: "fallback" };
}
function resolveClaudePath(cwd) {
  const result = resolveClaudeCli({ cacheDir: path.join(cwd, ".sna") });
  logger.log("agent", `claude path: ${result.source}=${result.path}${result.version ? ` (${result.version})` : ""}`);
  return result.path;
}
function buildClaudeEnv(claudePath, opts = {}) {
  const cleanEnv = { ...process.env, ...opts.env };
  if (opts.configDir) {
    cleanEnv.CLAUDE_CONFIG_DIR = opts.configDir;
  }
  const config = getConfig();
  const omlxUrl = opts.providerOmlxUrl ?? config.omlxBaseUrl;
  if (omlxUrl) {
    cleanEnv.ANTHROPIC_BASE_URL = typeof omlxUrl === "string" ? omlxUrl : String(omlxUrl);
  } else {
    const proxyPort = config.apiProxyPort;
    if (proxyPort) {
      cleanEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
    }
  }
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
  const claudeDir = path.dirname(claudePath);
  if (claudeDir && claudeDir !== ".") {
    cleanEnv.PATH = `${claudeDir}:${cleanEnv.PATH ?? ""}`;
  }
  return cleanEnv;
}
const _ClaudeCodeProcess = class _ClaudeCodeProcess {
  constructor(proc, options) {
    this.emitter = new EventEmitter();
    this._alive = true;
    this._sessionId = null;
    this._initEmitted = false;
    this.buffer = "";
    /** True once we receive a real text_delta stream_event this turn */
    this._receivedStreamEvents = false;
    /** tool_use IDs already emitted via stream_event (to update instead of re-create in assistant block) */
    this._streamedToolUseIds = /* @__PURE__ */ new Set();
    /**
     * FIFO event queue — ALL events (deltas, assistant, complete, etc.) go through
     * this queue. A fixed-interval timer drains one item at a time, guaranteeing
     * strict ordering: deltas → assistant → complete, never out of order.
     */
    this.eventQueue = [];
    this.drainTimer = null;
    this.proc = proc;
    proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        logger.log("stdout", line);
        try {
          const msg = JSON.parse(line);
          if (msg.session_id && !this._sessionId) {
            this._sessionId = msg.session_id;
          }
          const event = this.normalizeEvent(msg);
          if (event) this.enqueue(event);
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
          const event = this.normalizeEvent(msg);
          if (event) this.enqueue(event);
        } catch {
        }
      }
      this.flushQueue();
      this.emitter.emit("exit", code);
      logger.log("agent", `process exited (code=${code})`);
    });
    proc.on("error", (err) => {
      this._alive = false;
      this.emitter.emit("error", err);
    });
    if (options.prompt) {
      this.send(options.prompt);
    }
  }
  // ~67 events/sec
  /**
   * Enqueue an event for ordered emission.
   * Starts the drain timer if not already running.
   */
  enqueue(event) {
    this.eventQueue.push(event);
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.drainOne(), _ClaudeCodeProcess.DRAIN_INTERVAL_MS);
    }
  }
  /** Emit one event from the front of the queue. Stop timer when empty. */
  drainOne() {
    const event = this.eventQueue.shift();
    if (event) {
      this.emitter.emit("event", event);
    }
    if (this.eventQueue.length === 0 && this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }
  /** Flush all remaining queued events immediately (used on process exit). */
  flushQueue() {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    while (this.eventQueue.length > 0) {
      this.emitter.emit("event", this.eventQueue.shift());
    }
  }
  /**
   * Split completed assistant text into delta chunks and enqueue them,
   * followed by the final assistant event. All go through the FIFO queue
   * so subsequent events (complete, etc.) are guaranteed to come after.
   */
  enqueueTextAsDeltas(text) {
    const CHUNK_SIZE = 4;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      this.enqueue({
        type: "assistant_delta",
        delta: text.slice(i, i + CHUNK_SIZE),
        index: 0,
        timestamp: Date.now()
      });
    }
    this.enqueue({
      type: "assistant",
      message: text,
      timestamp: Date.now()
    });
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
  /**
   * Send a user message to the persistent Claude process via stdin.
   * Accepts plain string or content block array (text + images).
   */
  send(input) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const content = typeof input === "string" ? input : input;
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content }
    });
    logger.log("stdin", msg.slice(0, 200));
    this.proc.stdin.write(msg + "\n");
  }
  interrupt() {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "interrupt" }
    });
    this.proc.stdin.write(msg + "\n");
  }
  setModel(model) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "set_model", model }
    });
    this.proc.stdin.write(msg + "\n");
  }
  setPermissionMode(mode) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "set_permission_mode", permission_mode: mode }
    });
    this.proc.stdin.write(msg + "\n");
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
  normalizeEvent(msg) {
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") {
          if (this._initEmitted) return null;
          this._initEmitted = true;
          return {
            type: "init",
            message: `Agent ready (${msg.model ?? "unknown"})`,
            data: { sessionId: msg.session_id, model: msg.model },
            timestamp: Date.now()
          };
        }
        return null;
      }
      case "stream_event": {
        const inner = msg.event;
        if (!inner) return null;
        if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
          const block = inner.content_block;
          this._receivedStreamEvents = true;
          this._streamedToolUseIds.add(block.id);
          return {
            type: "tool_use",
            message: block.name,
            data: { toolName: block.name, id: block.id, input: null, streaming: true },
            timestamp: Date.now()
          };
        }
        if (inner.type === "content_block_delta") {
          const delta = inner.delta;
          if (delta?.type === "text_delta" && delta.text) {
            this._receivedStreamEvents = true;
            return {
              type: "assistant_delta",
              delta: delta.text,
              index: inner.index ?? 0,
              timestamp: Date.now()
            };
          }
          if (delta?.type === "thinking_delta" && delta.thinking) {
            return {
              type: "thinking_delta",
              message: delta.thinking,
              timestamp: Date.now()
            };
          }
        }
        return null;
      }
      case "assistant": {
        const hasToolUse = Array.isArray(msg.message?.content) && msg.message.content.some((b) => b.type === "tool_use");
        if (this._receivedStreamEvents && msg.message?.stop_reason === null && !hasToolUse) {
          return null;
        }
        const content = msg.message?.content;
        if (!Array.isArray(content)) return null;
        const events = [];
        const textBlocks = [];
        for (const block of content) {
          if (block.type === "thinking") {
            events.push({
              type: "thinking",
              message: block.thinking ?? "",
              timestamp: Date.now()
            });
          } else if (block.type === "tool_use") {
            const alreadyStreamed = this._streamedToolUseIds.has(block.id);
            if (alreadyStreamed) {
              this._streamedToolUseIds.delete(block.id);
              this.emitter.emit("event", {
                type: "tool_use",
                message: block.name,
                data: { toolName: block.name, input: block.input, id: block.id, update: true },
                timestamp: Date.now()
              });
            } else {
              events.push({
                type: "tool_use",
                message: block.name,
                data: { toolName: block.name, input: block.input, id: block.id, update: false },
                timestamp: Date.now()
              });
            }
          } else if (block.type === "text") {
            const text = (block.text ?? "").trim();
            if (text) {
              textBlocks.push(text);
            }
          }
        }
        if (events.length > 0 || textBlocks.length > 0) {
          const shouldEmitDirectly = this._receivedStreamEvents;
          for (const e of events) {
            if (shouldEmitDirectly) this.emitter.emit("event", e);
            else this.enqueue(e);
          }
          for (const text of textBlocks) {
            const event = { type: "assistant", message: text, timestamp: Date.now() };
            if (shouldEmitDirectly) this.emitter.emit("event", event);
            else this.enqueue(event);
          }
        }
        return null;
      }
      case "user": {
        const userContent = msg.message?.content;
        if (!Array.isArray(userContent)) return null;
        for (const block of userContent) {
          if (block.type === "tool_result") {
            return {
              type: "tool_result",
              message: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
              data: { toolUseId: block.tool_use_id, isError: block.is_error },
              timestamp: Date.now()
            };
          }
        }
        return null;
      }
      case "result": {
        if (msg.subtype === "success") {
          if (this._receivedStreamEvents && msg.result) {
            this.enqueue({
              type: "assistant",
              message: msg.result,
              timestamp: Date.now()
            });
            this._receivedStreamEvents = false;
            this._streamedToolUseIds.clear();
          }
          const u = msg.usage ?? {};
          const mu = msg.modelUsage ?? {};
          const modelKey = Object.keys(mu)[0] ?? "";
          const modelInfo = mu[modelKey] ?? {};
          return {
            type: "complete",
            message: msg.result ?? "Done",
            data: {
              durationMs: msg.duration_ms,
              costUsd: msg.total_cost_usd,
              // Per-turn: actual context window usage this turn
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              cacheReadTokens: u.cache_read_input_tokens ?? 0,
              cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
              // Static model info
              contextWindow: modelInfo.contextWindow ?? 0,
              model: modelKey
            },
            timestamp: Date.now()
          };
        }
        if (msg.subtype === "error_during_execution" && msg.is_error === false) {
          return {
            type: "interrupted",
            message: "Turn interrupted by user",
            data: { durationMs: msg.duration_ms, costUsd: msg.total_cost_usd },
            timestamp: Date.now()
          };
        }
        if (msg.subtype?.startsWith("error") || msg.is_error) {
          return {
            type: "error",
            message: msg.result ?? msg.error ?? "Unknown error",
            timestamp: Date.now()
          };
        }
        return null;
      }
      case "rate_limit_event":
        return null;
      default:
        logger.log("agent", `unhandled event: ${msg.type}`, JSON.stringify(msg).substring(0, 200));
        return null;
    }
  }
};
_ClaudeCodeProcess.DRAIN_INTERVAL_MS = 15;
let ClaudeCodeProcess = _ClaudeCodeProcess;
class ClaudeCodeProvider {
  constructor() {
    this.name = "claude-code";
  }
  async isAvailable() {
    try {
      const p = resolveClaudePath(process.cwd());
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
  async complete(options) {
    const cwd = options.cwd ?? process.cwd();
    const resolved = resolveClaudeCli({ cacheDir: void 0 });
    const claudeParts = resolved.path.split(/\s+/);
    const claudePath = claudeParts[0];
    const claudePrefix = claudeParts.slice(1);
    const args = [
      ...claudePrefix,
      "-p",
      "--output-format",
      "json",
      "--no-session-persistence"
    ];
    if (options.model) args.push("--model", options.model);
    if (options.systemPrompt) args.push("--system-prompt", options.systemPrompt);
    if (options.appendSystemPrompt) args.push("--append-system-prompt", options.appendSystemPrompt);
    if (options.extraArgs) args.push(...options.extraArgs);
    args.push(options.prompt);
    const po = options.providerOptions ?? {};
    const cleanEnv = buildClaudeEnv(claudePath, {
      env: options.env,
      providerOmlxUrl: po.omlxBaseUrl
    });
    const timeout = options.timeout ?? 6e4;
    const model = options.model ?? "unknown";
    logger.log("agent", `complete: provider=claude-code model=${model} prompt="${options.prompt.slice(0, 60)}..."`);
    return new Promise((resolve, reject) => {
      const proc = spawn(claudePath, args, {
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
      proc.on("close", (code) => {
        clearTimeout(timer);
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          reject(new Error(`complete: failed to parse JSON (code=${code}): ${stdout.slice(0, 200)} ${stderr.slice(0, 200)}`));
          return;
        }
        if (parsed.is_error) {
          reject(new Error(`complete error: ${parsed.result}`));
          return;
        }
        const modelKey = Object.keys(parsed.modelUsage)[0] ?? model;
        resolve({
          text: parsed.result,
          usage: {
            inputTokens: parsed.usage.input_tokens,
            outputTokens: parsed.usage.output_tokens,
            cacheReadTokens: parsed.usage.cache_read_input_tokens,
            cacheCreationTokens: parsed.usage.cache_creation_input_tokens
          },
          costUsd: parsed.total_cost_usd,
          durationMs: parsed.duration_ms,
          durationApiMs: parsed.duration_api_ms,
          model: modelKey
        });
      });
      proc.stdin.end();
    });
  }
  spawn(options) {
    const claudeCommand = resolveClaudePath(options.cwd);
    const claudeParts = claudeCommand.split(/\s+/);
    const claudePath = claudeParts[0];
    const claudePrefix = claudeParts.slice(1);
    let pkgRoot = path.dirname(fileURLToPath(import.meta.url));
    while (!fs.existsSync(path.join(pkgRoot, "package.json"))) {
      const parent = path.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const hookScript = path.join(pkgRoot, "dist", "scripts", "hook.js");
    const sessionId = options.env?.SNA_SESSION_ID ?? "default";
    const sdkSettings = {};
    if (options.permissionMode !== "bypassPermissions") {
      sdkSettings.hooks = {
        PreToolUse: [{
          matcher: ".*",
          hooks: [{ type: "command", command: `node "${hookScript}" --session=${sessionId}` }]
        }]
      };
    }
    const mergeAppSettings = (appSettings) => {
      if (appSettings.hooks && typeof appSettings.hooks === "object") {
        const appHooks = appSettings.hooks;
        for (const [event, hooks] of Object.entries(appHooks)) {
          const cur = sdkSettings.hooks;
          if (cur && cur[event]) {
            cur[event] = [...cur[event], ...hooks];
          } else {
            sdkSettings.hooks = sdkSettings.hooks ?? {};
            sdkSettings.hooks[event] = hooks;
          }
        }
        const rest = { ...appSettings };
        delete rest.hooks;
        Object.assign(sdkSettings, rest);
      } else {
        Object.assign(sdkSettings, appSettings);
      }
    };
    const po = options.providerOptions ?? {};
    if (po.settings && typeof po.settings === "object") {
      mergeAppSettings(po.settings);
    }
    let extraArgsClean = options.extraArgs ? [...options.extraArgs] : [];
    const settingsIdx = extraArgsClean.indexOf("--settings");
    if (settingsIdx !== -1 && settingsIdx + 1 < extraArgsClean.length) {
      try {
        mergeAppSettings(JSON.parse(extraArgsClean[settingsIdx + 1]));
      } catch {
      }
      extraArgsClean.splice(settingsIdx, 2);
    }
    const args = [
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--settings",
      JSON.stringify(sdkSettings)
    ];
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    }
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }
    if (options.appendSystemPrompt) {
      args.push("--append-system-prompt", options.appendSystemPrompt);
    }
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      args.push("--mcp-config", JSON.stringify({ mcpServers: options.mcpServers }));
    }
    if (options.allowedTools?.length) {
      args.push("--allowedTools", ...options.allowedTools);
    }
    if (options.disallowedTools?.length) {
      args.push("--disallowedTools", ...options.disallowedTools);
    }
    if (typeof po.maxTurns === "number") args.push("--max-turns", String(po.maxTurns));
    if (po.disableSlashCommands) args.push("--disable-slash-commands");
    if (po.strictMcpConfig) args.push("--strict-mcp-config");
    if (Array.isArray(po.settingSources)) {
      for (const src of po.settingSources) {
        args.push("--setting-sources", src);
      }
    }
    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }
    if (!options.resumeSessionId && options.history?.length) {
      const sessionId2 = options.env?.SNA_SESSION_ID ?? "default";
      const result = writeClaudeHistoryJsonl(options.history, { cwd: options.cwd, sessionId: sessionId2 });
      if (result) {
        args.push(...result.extraArgs);
        logger.log("agent", `history via JSONL resume \u2192 ${result.filePath}`);
      } else {
        logger.log("agent", "history injection skipped (adapter returned null)");
      }
    }
    if (extraArgsClean.length > 0) {
      args.push(...extraArgsClean);
    }
    const cleanEnv = buildClaudeEnv(claudePath, {
      env: options.env,
      configDir: options.configDir,
      providerOmlxUrl: po.omlxBaseUrl
    });
    const proc = spawn(claudePath, [...claudePrefix, ...args], {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    logger.log("agent", `spawned claude-code (pid=${proc.pid}) \u2192 ${claudeCommand} ${args.join(" ")}`);
    return new ClaudeCodeProcess(proc, options);
  }
}
export {
  ClaudeCodeProvider,
  buildClaudeEnv,
  cacheClaudePath,
  parseCommandVOutput,
  resolveClaudeCli,
  validateClaudePath
};
