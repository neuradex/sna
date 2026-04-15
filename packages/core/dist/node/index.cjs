"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.8_tsx@4.21.0_typescript@5.9.3/node_modules/tsup/assets/cjs_shims.js
var getImportMetaUrl, importMetaUrl;
var init_cjs_shims = __esm({
  "../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.8_tsx@4.21.0_typescript@5.9.3/node_modules/tsup/assets/cjs_shims.js"() {
    "use strict";
    getImportMetaUrl = () => typeof document === "undefined" ? new URL(`file:${__filename}`).href : document.currentScript && document.currentScript.tagName.toUpperCase() === "SCRIPT" ? document.currentScript.src : new URL("main.js", document.baseURI).href;
    importMetaUrl = /* @__PURE__ */ getImportMetaUrl();
  }
});

// src/lib/logger.ts
function setOnLog(cb) {
  _onLog = cb;
}
function setLogLevel(level) {
  _logLevel = level;
}
function shouldEmit(tag) {
  if (_logLevel === "silent") return false;
  const tagMinLevel = TAG_LEVELS[tag] ?? "info";
  return LEVEL_ORDER[tagMinLevel] >= LEVEL_ORDER[_logLevel];
}
function ts() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatLine(tag, args) {
  return `${ts()} ${tag} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
}
function appendFile(tag, args) {
  const line = formatLine(tag, args) + "\n";
  import_fs2.default.appendFile(LOG_PATH, line, () => {
  });
}
function log(tag, ...args) {
  const resolvedTag = tags[tag] ?? tag;
  appendFile(resolvedTag, args);
  if (!shouldEmit(tag)) return;
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.log(`${ts()} ${resolvedTag}`, ...args);
  }
}
function err(tag, ...args) {
  const resolvedTag = tags[tag] ?? tag;
  appendFile(resolvedTag, args);
  if (!shouldEmit(tag)) return;
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.error(`${ts()} ${resolvedTag}`, ...args);
  }
}
var import_fs2, import_path2, LOG_PATH, _onLog, _logLevel, TAG_LEVELS, LEVEL_ORDER, tags, logger;
var init_logger = __esm({
  "src/lib/logger.ts"() {
    "use strict";
    init_cjs_shims();
    import_fs2 = __toESM(require("fs"), 1);
    import_path2 = __toESM(require("path"), 1);
    LOG_PATH = process.env.SNA_LOG_PATH ?? import_path2.default.join(process.cwd(), ".dev.log");
    try {
      import_fs2.default.writeFileSync(LOG_PATH, "");
    } catch {
    }
    _onLog = null;
    _logLevel = "info";
    TAG_LEVELS = {
      err: "error",
      sna: "warn",
      agent: "warn",
      ws: "warn",
      req: "info",
      stdin: "info",
      stdout: "info",
      route: "info",
      langfuse: "info"
    };
    LEVEL_ORDER = { info: 0, warn: 1, error: 2, silent: 3 };
    tags = {
      sna: " SNA ",
      req: " REQ ",
      agent: " AGT ",
      stdin: " IN  ",
      stdout: " OUT ",
      route: " API ",
      ws: " WS  ",
      err: " ERR ",
      langfuse: " LFE "
    };
    logger = { log, err, setOnLog, setLogLevel };
  }
});

// src/config.ts
function fromEnv() {
  const env = {};
  if (process.env.SNA_PORT) env.port = parseInt(process.env.SNA_PORT, 10);
  if (process.env.SNA_MODEL) env.model = process.env.SNA_MODEL;
  if (process.env.SNA_PERMISSION_MODE) env.defaultPermissionMode = process.env.SNA_PERMISSION_MODE;
  if (process.env.SNA_MAX_SESSIONS) env.maxSessions = parseInt(process.env.SNA_MAX_SESSIONS, 10);
  if (process.env.SNA_DB_PATH) env.dbPath = process.env.SNA_DB_PATH;
  if (process.env.SNA_DATA_DIR) env.dataDir = process.env.SNA_DATA_DIR;
  if (process.env.SNA_PERMISSION_TIMEOUT_MS) env.permissionTimeoutMs = parseInt(process.env.SNA_PERMISSION_TIMEOUT_MS, 10);
  return env;
}
function getConfig() {
  return current;
}
var import_path3, defaults, current;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    init_cjs_shims();
    import_path3 = __toESM(require("path"), 1);
    defaults = {
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
      dbPath: "data/sna.db",
      dataDir: import_path3.default.join(process.cwd(), "data")
    };
    current = { ...defaults, ...fromEnv() };
  }
});

// src/lib/langfuse-tracer.ts
var init_langfuse_tracer = __esm({
  "src/lib/langfuse-tracer.ts"() {
    "use strict";
    init_cjs_shims();
    init_config();
    init_logger();
  }
});

// src/node/index.ts
var node_exports = {};
__export(node_exports, {
  startSnaServer: () => startSnaServer
});
module.exports = __toCommonJS(node_exports);
init_cjs_shims();

// src/electron/index.ts
init_cjs_shims();
var import_child_process3 = require("child_process");
var import_url3 = require("url");
var import_fs5 = __toESM(require("fs"), 1);

// src/core/providers/claude-code.ts
init_cjs_shims();
var import_child_process = require("child_process");
var import_events = require("events");
var import_fs3 = __toESM(require("fs"), 1);
var import_path4 = __toESM(require("path"), 1);
var import_url = require("url");

// src/core/providers/cc-history-adapter.ts
init_cjs_shims();
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

// src/core/providers/claude-code.ts
init_logger();
init_config();
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
    const claudeDir = import_path4.default.dirname(claudePath);
    const env = { ...process.env, PATH: `${claudeDir}:${process.env.PATH ?? ""}` };
    const out = (0, import_child_process.execSync)(`"${claudePath}" --version`, { encoding: "utf8", stdio: "pipe", timeout: 1e4, env }).trim();
    return { ok: true, version: out.split("\n")[0].slice(0, 30) };
  } catch {
    return { ok: false };
  }
}
function cacheClaudePath(claudePath, cacheDir) {
  const dir = cacheDir ?? import_path4.default.join(process.cwd(), ".sna");
  try {
    if (!import_fs3.default.existsSync(dir)) import_fs3.default.mkdirSync(dir, { recursive: true });
    import_fs3.default.writeFileSync(import_path4.default.join(dir, "claude-path"), claudePath);
  } catch {
  }
}
function resolveClaudeCli(opts) {
  const cacheDir = opts?.cacheDir;
  if (process.env.SNA_CLAUDE_COMMAND) {
    const v = validateClaudePath(process.env.SNA_CLAUDE_COMMAND);
    return { path: process.env.SNA_CLAUDE_COMMAND, version: v.version, source: "env" };
  }
  const cacheFile = cacheDir ? import_path4.default.join(cacheDir, "claude-path") : import_path4.default.join(process.cwd(), ".sna/claude-path");
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
  const result = resolveClaudeCli({ cacheDir: import_path4.default.join(cwd, ".sna") });
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
    let pkgRoot = import_path4.default.dirname((0, import_url.fileURLToPath)(importMetaUrl));
    while (!import_fs3.default.existsSync(import_path4.default.join(pkgRoot, "package.json"))) {
      const parent = import_path4.default.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const hookScript = import_path4.default.join(pkgRoot, "dist", "scripts", "hook.js");
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
    const proxyPort = getConfig().apiProxyPort;
    if (proxyPort) {
      cleanEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
    }
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
    const claudeDir = import_path4.default.dirname(claudePath);
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
var import_path7 = __toESM(require("path"), 1);
var import_hono4 = require("hono");
var import_cors = require("hono/cors");
var import_node_server = require("@hono/node-server");

// src/server/index.ts
init_cjs_shims();
var import_hono3 = require("hono");

// src/server/routes/events.ts
init_cjs_shims();
var import_streaming = require("hono/streaming");

// src/db/schema.ts
init_cjs_shims();
var import_node_module = require("module");
var import_path5 = __toESM(require("path"), 1);
var NATIVE_DIR = import_path5.default.join(process.cwd(), ".sna/native");

// src/server/routes/events.ts
init_config();

// src/server/routes/emit.ts
init_cjs_shims();

// src/server/api-types.ts
init_cjs_shims();

// src/server/routes/run.ts
init_cjs_shims();
var import_streaming2 = require("hono/streaming");
var ROOT = process.cwd();

// src/server/routes/agent.ts
init_cjs_shims();
var import_hono = require("hono");
var import_streaming3 = require("hono/streaming");

// src/core/providers/index.ts
init_cjs_shims();

// src/core/providers/codex.ts
init_cjs_shims();
var import_child_process2 = require("child_process");
var import_events2 = require("events");
var import_fs4 = __toESM(require("fs"), 1);
var import_path6 = __toESM(require("path"), 1);
var import_url2 = require("url");
init_logger();
var SHELL2 = process.env.SHELL || "/bin/zsh";
function validateCodexPath(codexPath) {
  try {
    const codexDir = import_path6.default.dirname(codexPath);
    const env = { ...process.env, PATH: `${codexDir}:${process.env.PATH ?? ""}` };
    const out = (0, import_child_process2.execSync)(`"${codexPath}" --version`, {
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
  const dir = cacheDir ?? import_path6.default.join(process.cwd(), ".sna");
  try {
    if (!import_fs4.default.existsSync(dir)) import_fs4.default.mkdirSync(dir, { recursive: true });
    import_fs4.default.writeFileSync(import_path6.default.join(dir, "codex-path"), codexPath);
  } catch {
  }
}
function resolveCodexCli(opts) {
  const cacheDir = opts?.cacheDir;
  if (process.env.SNA_CODEX_COMMAND) {
    const v = validateCodexPath(process.env.SNA_CODEX_COMMAND);
    return { path: process.env.SNA_CODEX_COMMAND, version: v.version, source: "env" };
  }
  const cacheFile = cacheDir ? import_path6.default.join(cacheDir, "codex-path") : import_path6.default.join(process.cwd(), ".sna/codex-path");
  try {
    const cached = import_fs4.default.readFileSync(cacheFile, "utf8").trim();
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
    const raw = (0, import_child_process2.execSync)(`${SHELL2} -i -l -c "command -v codex" 2>/dev/null`, {
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
  const result = resolveCodexCli({ cacheDir: import_path6.default.join(cwd, ".sna") });
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
function buildHistoryContext(history) {
  const turns = history.map(
    (msg) => `<${msg.role}>
${msg.content}
</${msg.role}>`
  ).join("\n\n");
  return `<conversation-history>
The following is our previous conversation. Use it as context.

${turns}
</conversation-history>

`;
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
var rpcIdCounter = 0;
function rpcRequest(method, params) {
  return { method, id: ++rpcIdCounter, params: params ?? {} };
}
function rpcNotification(method, params) {
  return { method, params: params ?? {} };
}
var _CodexProcess = class _CodexProcess {
  constructor(proc, options) {
    this.options = options;
    this.emitter = new import_events2.EventEmitter();
    this._alive = true;
    this._sessionId = null;
    this._threadId = null;
    this._initEmitted = false;
    this.buffer = "";
    this.pendingResponses = /* @__PURE__ */ new Map();
    /** Maps permission requestId → JSON-RPC server request id for approval responses. */
    this.pendingServerRequests = /* @__PURE__ */ new Map();
    this._ready = false;
    this._pendingSend = [];
    /** Set when interrupt() is called — causes queue to fast-drain delta events. */
    this._interrupted = false;
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
    proc.on("error", (err2) => {
      this._alive = false;
      this.emitter.emit("error", err2);
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
   * Stores the rpcId so we can respond later via respondToPermission().
   */
  handleServerRequest(method, rpcId, params) {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      const requestId = params.itemId ?? params.id ?? `perm-${rpcId}`;
      this.pendingServerRequests.set(requestId, rpcId);
      const isFileChange = method.includes("fileChange");
      this.enqueue({
        type: "permission_needed",
        message: isFileChange ? `File change: ${params.path ?? "unknown"}` : `Command: ${params.command ?? "unknown"}`,
        data: {
          requestId,
          toolName: isFileChange ? "file_change" : "shell",
          command: params.command,
          path: params.path,
          itemId: params.itemId
        },
        timestamp: Date.now()
      });
      return;
    }
    logger.log("agent", `codex unknown server request: ${method} (id=${rpcId})`);
    this.write({ id: rpcId, result: {} });
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
      const sysPrompt = extractSystemPromptArgs(
        resumeInfo ? resumeInfo.cleanArgs : this.options.extraArgs
      );
      const sandbox = toCodexSandbox(this.options.permissionMode);
      const threadParams = {
        sandbox,
        ...this.options.model ? { model: this.options.model } : {},
        ...sysPrompt.baseInstructions ? { baseInstructions: sysPrompt.baseInstructions } : {},
        ...sysPrompt.developerInstructions ? { developerInstructions: sysPrompt.developerInstructions } : {}
      };
      if (resumeInfo?.threadId) {
        const resumeResult = await this.sendRpc("thread/resume", {
          threadId: resumeInfo.threadId,
          ...sysPrompt.baseInstructions ? { baseInstructions: sysPrompt.baseInstructions } : {},
          ...sysPrompt.developerInstructions ? { developerInstructions: sysPrompt.developerInstructions } : {}
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
          timestamp: Date.now()
        });
      }
      let prompt = this.options.prompt;
      if (this.options.history?.length && prompt) {
        const context = buildHistoryContext(this.options.history);
        prompt = context + prompt;
        logger.log("agent", `codex: injected ${this.options.history.length} history messages as context`);
      } else if (this.options.history?.length && !prompt) {
        const context = buildHistoryContext(this.options.history);
        prompt = context + "Continue from where we left off. What would you like to do next?";
        logger.log("agent", `codex: injected ${this.options.history.length} history messages (no prompt)`);
      }
      if (prompt) {
        this.startTurn(prompt);
      }
      for (const fn of this._pendingSend) fn();
      this._pendingSend = [];
    } catch (err2) {
      logger.err("agent", `codex init failed:`, err2);
      this.enqueue({
        type: "error",
        message: `Codex initialization failed: ${err2}`,
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
    this.sendRpc("turn/start", {
      threadId: this._threadId,
      input: contentBlocks
    }).then((result) => {
      if (result?.turn?.id) this._currentTurnId = result.turn.id;
    }).catch((err2) => {
      logger.err("agent", "turn/start failed:", err2);
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
    }).catch((err2) => {
      logger.err("agent", `codex: turn/interrupt failed:`, err2);
      this.enqueue({
        type: "interrupted",
        message: "Turn interrupted",
        data: { provider: "codex" },
        timestamp: Date.now()
      });
    });
  }
  setModel(_model) {
    logger.log("agent", "codex: setModel ignored (set at thread creation)");
  }
  setPermissionMode(_mode) {
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
  respondToPermission(requestId, approved) {
    const rpcId = this.pendingServerRequests.get(requestId);
    if (rpcId == null) {
      logger.log("agent", `codex: no pending server request for ${requestId}`);
      return;
    }
    this.pendingServerRequests.delete(requestId);
    const decision = approved ? "accept" : "decline";
    this.write({ id: rpcId, result: { decision } });
    logger.log("agent", `codex: permission ${decision} (rpcId=${rpcId}, requestId=${requestId})`);
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
var CodexProcess = _CodexProcess;
var CodexProvider = class {
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
  spawn(options) {
    const codexPath = resolveCodexPath(options.cwd);
    const args = ["app-server"];
    const cleanEnv = { ...process.env, ...options.env };
    const codexHome = options.configDir ?? import_path6.default.join(options.cwd, ".sna", "codex-home");
    if (!import_fs4.default.existsSync(codexHome)) {
      import_fs4.default.mkdirSync(codexHome, { recursive: true });
    }
    const realCodexHome = `${process.env.HOME}/.codex`;
    for (const f of ["auth.json", "installation_id"]) {
      const src = import_path6.default.join(realCodexHome, f);
      const dst = import_path6.default.join(codexHome, f);
      if (import_fs4.default.existsSync(src) && !import_fs4.default.existsSync(dst)) {
        import_fs4.default.copyFileSync(src, dst);
      }
    }
    const configTomlPath = import_path6.default.join(codexHome, "config.toml");
    if (!import_fs4.default.existsSync(configTomlPath)) {
      const realConfig = import_path6.default.join(realCodexHome, "config.toml");
      if (import_fs4.default.existsSync(realConfig)) {
        import_fs4.default.copyFileSync(realConfig, configTomlPath);
      }
    }
    cleanEnv.CODEX_HOME = codexHome;
    if (options.permissionMode !== "bypassPermissions") {
      let pkgRoot = import_path6.default.dirname((0, import_url2.fileURLToPath)(importMetaUrl));
      while (!import_fs4.default.existsSync(import_path6.default.join(pkgRoot, "package.json"))) {
        const parent = import_path6.default.dirname(pkgRoot);
        if (parent === pkgRoot) break;
        pkgRoot = parent;
      }
      const hookScript = import_path6.default.join(pkgRoot, "dist", "scripts", "hook.js");
      const sessionId = options.env?.SNA_SESSION_ID ?? "default";
      const hooksJson = {
        hooks: {
          PreToolUse: [{
            matcher: ".*",
            hooks: [{
              type: "command",
              command: `node "${hookScript}" --session=${sessionId}`,
              timeout: 300
            }]
          }]
        }
      };
      import_fs4.default.writeFileSync(import_path6.default.join(codexHome, "hooks.json"), JSON.stringify(hooksJson));
      const existingConfig = import_fs4.default.readFileSync(configTomlPath, "utf8");
      if (!existingConfig.includes("codex_hooks")) {
        import_fs4.default.appendFileSync(configTomlPath, "\n[features]\ncodex_hooks = true\n");
      }
      logger.log("agent", `codex: hooks injected \u2192 ${hookScript} --session=${sessionId}`);
    }
    logger.log("agent", `codex: CODEX_HOME=${codexHome}`);
    const codexDir = import_path6.default.dirname(codexPath);
    if (codexDir && codexDir !== ".") {
      cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
    }
    const resumeInfo = extractResumeArg(options.extraArgs);
    const sysInfo = extractSystemPromptArgs(resumeInfo ? resumeInfo.cleanArgs : options.extraArgs);
    if (sysInfo.cleanArgs.length) {
      args.push(...sysInfo.cleanArgs);
    }
    const proc = (0, import_child_process2.spawn)(codexPath, args, {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    logger.log("agent", `spawned codex app-server (pid=${proc.pid}) \u2192 ${codexPath} ${args.join(" ")}`);
    return new CodexProcess(proc, options);
  }
};

// src/core/providers/index.ts
var providers = {
  "claude-code": new ClaudeCodeProvider(),
  "codex": new CodexProvider()
};

// src/server/routes/agent.ts
init_logger();

// src/server/history-builder.ts
init_cjs_shims();

// src/server/image-store.ts
init_cjs_shims();
init_config();

// src/server/routes/agent.ts
init_config();

// src/core/completion.ts
init_cjs_shims();
init_logger();
init_config();
init_langfuse_tracer();

// src/server/routes/chat.ts
init_cjs_shims();
var import_hono2 = require("hono");

// src/server/session-manager.ts
init_cjs_shims();
init_config();

// src/server/ws.ts
init_cjs_shims();
var import_ws = require("ws");
init_logger();
init_config();

// src/electron/index.ts
init_config();
init_logger();
function resolveStandaloneScript() {
  const selfPath = (0, import_url3.fileURLToPath)(importMetaUrl);
  let script = import_path7.default.resolve(import_path7.default.dirname(selfPath), "../server/standalone.js");
  if (script.includes(".asar") && !script.includes(".asar.unpacked")) {
    script = script.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }
  if (!import_fs5.default.existsSync(script)) {
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
  const unpacked = import_path7.default.join(resourcesPath, "app.asar.unpacked", "node_modules");
  if (!import_fs5.default.existsSync(unpacked)) return void 0;
  const existing = process.env.NODE_PATH;
  return existing ? `${unpacked}${import_path7.default.delimiter}${existing}` : unpacked;
}
async function startSnaServer(options) {
  const port = options.port ?? 3099;
  const cwd = options.cwd ?? import_path7.default.dirname(options.dbPath);
  const readyTimeout = options.readyTimeout ?? 15e3;
  const { onLog } = options;
  const standaloneScript = resolveStandaloneScript();
  const nodePath = buildNodePath();
  let consumerModules;
  try {
    const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
    consumerModules = import_path7.default.resolve(bsPkg, "../..");
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
  const proc = (0, import_child_process3.fork)(standaloneScript, [], {
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
