"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/node/index.ts
var node_exports = {};
__export(node_exports, {
  startSnaServer: () => startSnaServer
});
module.exports = __toCommonJS(node_exports);

// ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.8_tsx@4.21.0_typescript@5.9.3/node_modules/tsup/assets/cjs_shims.js
var getImportMetaUrl = () => typeof document === "undefined" ? new URL(`file:${__filename}`).href : document.currentScript && document.currentScript.tagName.toUpperCase() === "SCRIPT" ? document.currentScript.src : new URL("main.js", document.baseURI).href;
var importMetaUrl = /* @__PURE__ */ getImportMetaUrl();

// src/electron/index.ts
var import_child_process2 = require("child_process");
var import_url2 = require("url");
var import_fs4 = __toESM(require("fs"), 1);

// src/core/providers/claude-code.ts
var import_child_process = require("child_process");
var import_events = require("events");
var import_fs3 = __toESM(require("fs"), 1);
var import_path3 = __toESM(require("path"), 1);
var import_url = require("url");

// src/core/providers/cc-history-adapter.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
function writeHistoryJsonl(history, opts) {
  for (let i = 1; i < history.length; i++) {
    if (history[i].role === history[i - 1].role) {
      throw new Error(
        `History validation failed: consecutive ${history[i].role} at index ${i - 1} and ${i}. Messages must alternate user\u2194assistant. Merge tool results into text before injecting.`
      );
    }
  }
  try {
    const dir = import_path.default.join(opts.cwd, ".sna", "history");
    import_fs.default.mkdirSync(dir, { recursive: true });
    const sessionId = crypto.randomUUID();
    const filePath = import_path.default.join(dir, `${sessionId}.jsonl`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const lines = [];
    let prevUuid = null;
    for (const msg of history) {
      const uuid = crypto.randomUUID();
      if (msg.role === "user") {
        lines.push(JSON.stringify({
          parentUuid: prevUuid,
          isSidechain: false,
          type: "user",
          uuid,
          timestamp: now,
          cwd: opts.cwd,
          sessionId,
          message: { role: "user", content: msg.content }
        }));
      } else {
        lines.push(JSON.stringify({
          parentUuid: prevUuid,
          isSidechain: false,
          type: "assistant",
          uuid,
          timestamp: now,
          cwd: opts.cwd,
          sessionId,
          message: {
            role: "assistant",
            content: [{ type: "text", text: msg.content }]
          }
        }));
      }
      prevUuid = uuid;
    }
    import_fs.default.writeFileSync(filePath, lines.join("\n") + "\n");
    return { filePath, extraArgs: ["--resume", filePath] };
  } catch {
    return null;
  }
}
function buildRecalledConversation(history) {
  const xml = history.map((msg) => `<${msg.role}>${msg.content}</${msg.role}>`).join("\n");
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `<recalled-conversation>
${xml}
</recalled-conversation>` }]
    }
  });
}

// src/lib/logger.ts
var import_fs2 = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
var LOG_PATH = process.env.SNA_LOG_PATH ?? import_path2.default.join(process.cwd(), ".dev.log");
try {
  import_fs2.default.writeFileSync(LOG_PATH, "");
} catch {
}
function ts() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
var tags = {
  sna: " SNA ",
  req: " REQ ",
  agent: " AGT ",
  stdin: " IN  ",
  stdout: " OUT ",
  route: " API ",
  ws: " WS  ",
  err: " ERR "
};
function appendFile(tag, args) {
  const line = `${ts()} ${tag} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}
`;
  import_fs2.default.appendFile(LOG_PATH, line, () => {
  });
}
function log(tag, ...args) {
  console.log(`${ts()} ${tags[tag] ?? tag}`, ...args);
  appendFile(tags[tag] ?? tag, args);
}
function err(tag, ...args) {
  console.error(`${ts()} ${tags[tag] ?? tag}`, ...args);
  appendFile(tags[tag] ?? tag, args);
}
var logger = { log, err };

// src/core/providers/claude-code.ts
var SHELL = process.env.SHELL || "/bin/zsh";
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
    const claudeDir = import_path3.default.dirname(claudePath);
    const env = { ...process.env, PATH: `${claudeDir}:${process.env.PATH ?? ""}` };
    const out = (0, import_child_process.execSync)(`"${claudePath}" --version`, { encoding: "utf8", stdio: "pipe", timeout: 1e4, env }).trim();
    return { ok: true, version: out.split("\n")[0].slice(0, 30) };
  } catch {
    return { ok: false };
  }
}
function cacheClaudePath(claudePath, cacheDir) {
  const dir = cacheDir ?? import_path3.default.join(process.cwd(), ".sna");
  try {
    if (!import_fs3.default.existsSync(dir)) import_fs3.default.mkdirSync(dir, { recursive: true });
    import_fs3.default.writeFileSync(import_path3.default.join(dir, "claude-path"), claudePath);
  } catch {
  }
}
function resolveClaudeCli(opts) {
  const cacheDir = opts?.cacheDir;
  if (process.env.SNA_CLAUDE_COMMAND) {
    const v = validateClaudePath(process.env.SNA_CLAUDE_COMMAND);
    return { path: process.env.SNA_CLAUDE_COMMAND, version: v.version, source: "env" };
  }
  const cacheFile = cacheDir ? import_path3.default.join(cacheDir, "claude-path") : import_path3.default.join(process.cwd(), ".sna/claude-path");
  try {
    const cached = import_fs3.default.readFileSync(cacheFile, "utf8").trim();
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
    const raw = (0, import_child_process.execSync)(`${SHELL} -i -l -c "command -v claude" 2>/dev/null`, { encoding: "utf8", timeout: 5e3 }).trim();
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
  const result = resolveClaudeCli({ cacheDir: import_path3.default.join(cwd, ".sna") });
  logger.log("agent", `claude path: ${result.source}=${result.path}${result.version ? ` (${result.version})` : ""}`);
  return result.path;
}
var _ClaudeCodeProcess = class _ClaudeCodeProcess {
  constructor(proc, options) {
    this.emitter = new import_events.EventEmitter();
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
    proc.on("error", (err2) => {
      this._alive = false;
      this.emitter.emit("error", err2);
    });
    if (options.history?.length && !options._historyViaResume) {
      const line = buildRecalledConversation(options.history);
      this.proc.stdin.write(line + "\n");
    }
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
        if (this._receivedStreamEvents && msg.message?.stop_reason === null) return null;
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
            if (alreadyStreamed) this._streamedToolUseIds.delete(block.id);
            events.push({
              type: "tool_use",
              message: block.name,
              data: { toolName: block.name, input: block.input, id: block.id, update: alreadyStreamed },
              timestamp: Date.now()
            });
          } else if (block.type === "text") {
            const text = (block.text ?? "").trim();
            if (text) {
              textBlocks.push(text);
            }
          }
        }
        if (events.length > 0 || textBlocks.length > 0) {
          for (const e of events) {
            this.enqueue(e);
          }
          for (const text of textBlocks) {
            this.enqueue({ type: "assistant", message: text, timestamp: Date.now() });
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
              message: typeof block.content === "string" ? block.content.slice(0, 300) : JSON.stringify(block.content).slice(0, 300),
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
var ClaudeCodeProcess = _ClaudeCodeProcess;
var ClaudeCodeProvider = class {
  constructor() {
    this.name = "claude-code";
  }
  async isAvailable() {
    try {
      const p = resolveClaudePath(process.cwd());
      (0, import_child_process.execSync)(`test -x "${p}"`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
  spawn(options) {
    const claudeCommand = resolveClaudePath(options.cwd);
    const claudeParts = claudeCommand.split(/\s+/);
    const claudePath = claudeParts[0];
    const claudePrefix = claudeParts.slice(1);
    let pkgRoot = import_path3.default.dirname((0, import_url.fileURLToPath)(importMetaUrl));
    while (!import_fs3.default.existsSync(import_path3.default.join(pkgRoot, "package.json"))) {
      const parent = import_path3.default.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const hookScript = import_path3.default.join(pkgRoot, "dist", "scripts", "hook.js");
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
    let extraArgsClean = options.extraArgs ? [...options.extraArgs] : [];
    const settingsIdx = extraArgsClean.indexOf("--settings");
    if (settingsIdx !== -1 && settingsIdx + 1 < extraArgsClean.length) {
      try {
        const appSettings = JSON.parse(extraArgsClean[settingsIdx + 1]);
        if (appSettings.hooks) {
          for (const [event, hooks] of Object.entries(appSettings.hooks)) {
            if (sdkSettings.hooks && sdkSettings.hooks[event]) {
              sdkSettings.hooks[event] = [
                ...sdkSettings.hooks[event],
                ...hooks
              ];
            } else {
              sdkSettings.hooks[event] = hooks;
            }
          }
          delete appSettings.hooks;
        }
        Object.assign(sdkSettings, appSettings);
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
    if (options.history?.length && options.prompt) {
      const result = writeHistoryJsonl(options.history, { cwd: options.cwd });
      if (result) {
        args.push(...result.extraArgs);
        options._historyViaResume = true;
        logger.log("agent", `history via JSONL resume \u2192 ${result.filePath}`);
      }
    }
    if (extraArgsClean.length > 0) {
      args.push(...extraArgsClean);
    }
    const cleanEnv = { ...process.env, ...options.env };
    if (options.configDir) {
      cleanEnv.CLAUDE_CONFIG_DIR = options.configDir;
    }
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
    const claudeDir = import_path3.default.dirname(claudePath);
    if (claudeDir && claudeDir !== ".") {
      cleanEnv.PATH = `${claudeDir}:${cleanEnv.PATH ?? ""}`;
    }
    const proc = (0, import_child_process.spawn)(claudePath, [...claudePrefix, ...args], {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    logger.log("agent", `spawned claude-code (pid=${proc.pid}) \u2192 ${claudeCommand} ${args.join(" ")}`);
    return new ClaudeCodeProcess(proc, options);
  }
};

// src/electron/index.ts
var import_path6 = __toESM(require("path"), 1);
var import_hono4 = require("hono");
var import_cors = require("hono/cors");
var import_node_server = require("@hono/node-server");

// src/server/index.ts
var import_hono3 = require("hono");

// src/server/routes/events.ts
var import_streaming = require("hono/streaming");

// src/db/schema.ts
var import_node_module = require("module");
var import_path4 = __toESM(require("path"), 1);
var NATIVE_DIR = import_path4.default.join(process.cwd(), ".sna/native");

// src/config.ts
var defaults = {
  port: 3099,
  model: "claude-sonnet-4-6",
  defaultProvider: "claude-code",
  defaultPermissionMode: "default",
  maxSessions: 5,
  maxEventBuffer: 500,
  permissionTimeoutMs: 0,
  // app controls — no SDK-side timeout
  runOnceTimeoutMs: 12e4,
  pollIntervalMs: 500,
  keepaliveIntervalMs: 15e3,
  skillPollMs: 2e3,
  dbPath: "data/sna.db"
};
function fromEnv() {
  const env = {};
  if (process.env.SNA_PORT) env.port = parseInt(process.env.SNA_PORT, 10);
  if (process.env.SNA_MODEL) env.model = process.env.SNA_MODEL;
  if (process.env.SNA_PERMISSION_MODE) env.defaultPermissionMode = process.env.SNA_PERMISSION_MODE;
  if (process.env.SNA_MAX_SESSIONS) env.maxSessions = parseInt(process.env.SNA_MAX_SESSIONS, 10);
  if (process.env.SNA_DB_PATH) env.dbPath = process.env.SNA_DB_PATH;
  if (process.env.SNA_PERMISSION_TIMEOUT_MS) env.permissionTimeoutMs = parseInt(process.env.SNA_PERMISSION_TIMEOUT_MS, 10);
  return env;
}
var current = { ...defaults, ...fromEnv() };

// src/server/routes/run.ts
var import_streaming2 = require("hono/streaming");
var ROOT = process.cwd();

// src/server/routes/agent.ts
var import_hono = require("hono");
var import_streaming3 = require("hono/streaming");

// src/core/providers/codex.ts
var CodexProvider = class {
  constructor() {
    this.name = "codex";
  }
  async isAvailable() {
    return false;
  }
  spawn(_options) {
    throw new Error("Codex provider not yet implemented");
  }
};

// src/core/providers/index.ts
var providers = {
  "claude-code": new ClaudeCodeProvider(),
  "codex": new CodexProvider()
};

// src/server/image-store.ts
var import_path5 = __toESM(require("path"), 1);
var IMAGE_DIR = import_path5.default.join(process.cwd(), "data/images");

// src/server/routes/chat.ts
var import_hono2 = require("hono");

// src/server/ws.ts
var import_ws = require("ws");

// src/electron/index.ts
function resolveStandaloneScript() {
  const selfPath = (0, import_url2.fileURLToPath)(importMetaUrl);
  let script = import_path6.default.resolve(import_path6.default.dirname(selfPath), "../server/standalone.js");
  if (script.includes(".asar") && !script.includes(".asar.unpacked")) {
    script = script.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }
  if (!import_fs4.default.existsSync(script)) {
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
  const unpacked = import_path6.default.join(resourcesPath, "app.asar.unpacked", "node_modules");
  if (!import_fs4.default.existsSync(unpacked)) return void 0;
  const existing = process.env.NODE_PATH;
  return existing ? `${unpacked}${import_path6.default.delimiter}${existing}` : unpacked;
}
async function startSnaServer(options) {
  const port = options.port ?? 3099;
  const cwd = options.cwd ?? import_path6.default.dirname(options.dbPath);
  const readyTimeout = options.readyTimeout ?? 15e3;
  const { onLog } = options;
  const standaloneScript = resolveStandaloneScript();
  const nodePath = buildNodePath();
  let consumerModules;
  try {
    const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
    consumerModules = import_path6.default.resolve(bsPkg, "../..");
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
    ...options.nativeBinding ? { SNA_SQLITE_NATIVE_BINDING: options.nativeBinding } : {},
    ...consumerModules ? { SNA_MODULES_PATH: consumerModules } : {},
    ...nodePath ? { NODE_PATH: nodePath } : {},
    // Consumer overrides last so they can always win
    ...options.env ?? {}
  };
  const proc = (0, import_child_process2.fork)(standaloneScript, [], {
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
    proc.on("error", (err2) => {
      if (!isReady) {
        clearTimeout(timer);
        reject(err2);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startSnaServer
});
