// src/server/standalone.ts
import { serve } from "@hono/node-server";
import { Hono as Hono4 } from "hono";
import { cors } from "hono/cors";

// src/server/index.ts
import { Hono as Hono3 } from "hono";

// src/server/routes/agent.ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

// src/core/providers/claude-code.ts
import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import fs3 from "fs";
import path4 from "path";
import { fileURLToPath } from "url";

// src/history/claude-code.ts
import fs from "fs";
import path2 from "path";

// src/config.ts
import path from "path";
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
  dbPath: "data/sna.db",
  dataDir: path.join(process.cwd(), "data")
};
function fromEnv() {
  const env = {};
  if (process.env.SNA_PORT) env.port = parseInt(process.env.SNA_PORT, 10);
  if (process.env.SNA_MODEL) env.model = process.env.SNA_MODEL;
  if (process.env.SNA_PERMISSION_MODE) env.defaultPermissionMode = process.env.SNA_PERMISSION_MODE;
  if (process.env.SNA_MAX_SESSIONS) env.maxSessions = parseInt(process.env.SNA_MAX_SESSIONS, 10);
  if (process.env.SNA_DB_PATH) env.dbPath = process.env.SNA_DB_PATH;
  if (process.env.SNA_DATA_DIR) env.dataDir = process.env.SNA_DATA_DIR;
  if (process.env.SNA_PERMISSION_TIMEOUT_MS) env.permissionTimeoutMs = parseInt(process.env.SNA_PERMISSION_TIMEOUT_MS, 10);
  if (process.env.SNA_OMLX_BASE_URL) env.omlxBaseUrl = process.env.SNA_OMLX_BASE_URL;
  return env;
}
var current = { ...defaults, ...fromEnv() };
function getConfig() {
  return current;
}

// src/history/embed-refs.ts
var EMBED_REF_RE = /!\[[^\]]*\]\(embed:\/\/([^)\s]+)\)/g;
function splitContentByEmbeds(content) {
  const segments = [];
  let lastIndex = 0;
  EMBED_REF_RE.lastIndex = 0;
  let m;
  while ((m = EMBED_REF_RE.exec(content)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "text", text: content.slice(lastIndex, m.index) });
    }
    segments.push({ type: "embed", id: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", text: content.slice(lastIndex) });
  }
  return segments;
}
function formatEmbedRef(id, altText = "") {
  return `![${altText}](embed://${id})`;
}

// src/history/claude-code.ts
function renderTextWithEmbeds(content, embeds, sessionId) {
  const segments = splitContentByEmbeds(content);
  const out = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      if (seg.text.length > 0) out.push({ type: "text", text: seg.text });
    } else {
      const record = embeds?.[seg.id];
      if (!record) continue;
      const data = loadEmbedAsBase64(sessionId, record);
      if (!data) continue;
      out.push({
        type: "image",
        source: { type: "base64", media_type: record.mime_type, data }
      });
    }
  }
  return out;
}
function loadEmbedAsBase64(sessionId, record) {
  const fullPath = path2.isAbsolute(record.path) ? record.path : path2.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    return fs.readFileSync(fullPath).toString("base64");
  } catch {
    return null;
  }
}
function canonicalToAnthropicMessages(blocks, sessionId) {
  const msgs = [];
  let current2 = null;
  const flushCurrent = () => {
    if (current2 && current2.content.length > 0) msgs.push(current2);
    current2 = null;
  };
  for (const b of blocks) {
    if (b.actor === "user" && b.kind === "text") {
      flushCurrent();
      current2 = { role: "user", content: renderTextWithEmbeds(b.content, b.embeds, sessionId) };
      flushCurrent();
      continue;
    }
    if (b.actor === "assistant") {
      if (!current2 || current2.role !== "assistant") {
        flushCurrent();
        current2 = { role: "assistant", content: [] };
      }
      if (b.kind === "text") {
        current2.content.push(...renderTextWithEmbeds(b.content, b.embeds, sessionId));
      } else if (b.kind === "thinking") {
        const signature = typeof b.meta?.signature === "string" ? b.meta.signature : void 0;
        current2.content.push({ type: "thinking", thinking: b.content, ...signature ? { signature } : {} });
      } else if (b.kind === "tool_use") {
        const id = b.meta?.id ?? `tool_${b.id ?? Math.random().toString(36).slice(2)}`;
        const name = b.content || b.meta?.name || "tool";
        const input = b.meta?.input ?? {};
        current2.content.push({ type: "tool_use", id, name, input });
      }
      continue;
    }
    if (b.actor === "system" && b.kind === "tool_result") {
      if (!current2 || current2.role !== "user") {
        flushCurrent();
        current2 = { role: "user", content: [] };
      }
      const toolUseId = b.meta?.toolUseId ?? "";
      const isError = b.meta?.isError === true;
      const inner = renderTextWithEmbeds(b.content, b.embeds, sessionId);
      const resultContent = inner.length === 1 && inner[0].type === "text" ? inner[0].text : inner;
      current2.content.push({
        type: "tool_result",
        tool_use_id: toolUseId,
        content: resultContent,
        ...isError ? { is_error: true } : {}
      });
      continue;
    }
  }
  flushCurrent();
  return repairOrphanToolUses(msgs);
}
function repairOrphanToolUses(msgs) {
  const repaired = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    repaired.push(m);
    if (m.role !== "assistant") continue;
    const toolUseIds = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
    if (toolUseIds.length === 0) continue;
    const next = msgs[i + 1];
    const satisfied = /* @__PURE__ */ new Set();
    if (next && next.role === "user") {
      for (const b of next.content) {
        if (b.type === "tool_result") satisfied.add(b.tool_use_id);
      }
    }
    const missing = toolUseIds.filter((id) => !satisfied.has(id));
    if (missing.length === 0) continue;
    const syntheticResults = missing.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: "(tool call did not produce a result; synthesized during history restore)",
      is_error: true
    }));
    if (next && next.role === "user") {
      next.content = [...syntheticResults, ...next.content];
    } else {
      repaired.push({ role: "user", content: syntheticResults });
    }
  }
  return repaired;
}
function assertAlternating(msgs) {
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].role === msgs[i - 1].role) {
      throw new Error(
        `Claude JSONL validation failed: consecutive ${msgs[i].role} at index ${i - 1} and ${i}. This usually means canonical blocks are mis-ordered (tool_result without a preceding tool_use, etc.).`
      );
    }
  }
}
function writeClaudeHistoryJsonl(blocks, opts) {
  const msgs = canonicalToAnthropicMessages(blocks, opts.sessionId);
  if (msgs.length === 0) return null;
  assertAlternating(msgs);
  try {
    const dir = path2.join(opts.cwd, ".sna", "history");
    fs.mkdirSync(dir, { recursive: true });
    const syntheticSessionId = crypto.randomUUID();
    const filePath = path2.join(dir, `${syntheticSessionId}.jsonl`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const lines = [];
    let prevUuid = null;
    for (const m of msgs) {
      const uuid = crypto.randomUUID();
      lines.push(JSON.stringify({
        parentUuid: prevUuid,
        isSidechain: false,
        type: m.role,
        // "user" | "assistant"
        uuid,
        timestamp: now,
        cwd: opts.cwd,
        sessionId: syntheticSessionId,
        message: { role: m.role, content: m.content }
      }));
      prevUuid = uuid;
    }
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    return { filePath, extraArgs: ["--resume", filePath] };
  } catch {
    return null;
  }
}

// src/lib/logger.ts
import fs2 from "fs";
import path3 from "path";
var LOG_PATH = process.env.SNA_LOG_PATH ?? path3.join(process.cwd(), ".dev.log");
try {
  fs2.writeFileSync(LOG_PATH, "");
} catch {
}
var _onLog = null;
function setOnLog(cb) {
  _onLog = cb;
}
var _logLevel = "info";
function setLogLevel(level) {
  _logLevel = level;
}
var TAG_LEVELS = {
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
var LEVEL_ORDER = { info: 0, warn: 1, error: 2, silent: 3 };
function shouldEmit(tag) {
  if (_logLevel === "silent") return false;
  const tagMinLevel = TAG_LEVELS[tag] ?? "info";
  return LEVEL_ORDER[tagMinLevel] >= LEVEL_ORDER[_logLevel];
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
  err: " ERR ",
  langfuse: " LFE "
};
function formatLine(tag, args) {
  return `${ts()} ${tag} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
}
function appendFile(tag, args) {
  const line = formatLine(tag, args) + "\n";
  fs2.appendFile(LOG_PATH, line, () => {
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
var logger = { log, err, setOnLog, setLogLevel };

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
    const claudeDir = path4.dirname(claudePath);
    const env = { ...process.env, PATH: `${claudeDir}:${process.env.PATH ?? ""}` };
    const out = execSync(`"${claudePath}" --version`, { encoding: "utf8", stdio: "pipe", timeout: 1e4, env }).trim();
    return { ok: true, version: out.split("\n")[0].slice(0, 30) };
  } catch {
    return { ok: false };
  }
}
function cacheClaudePath(claudePath, cacheDir) {
  const dir = cacheDir ?? path4.join(process.cwd(), ".sna");
  try {
    if (!fs3.existsSync(dir)) fs3.mkdirSync(dir, { recursive: true });
    fs3.writeFileSync(path4.join(dir, "claude-path"), claudePath);
  } catch {
  }
}
function resolveClaudeCli(opts) {
  const cacheDir = opts?.cacheDir;
  if (process.env.SNA_CLAUDE_COMMAND) {
    const v = validateClaudePath(process.env.SNA_CLAUDE_COMMAND);
    return { path: process.env.SNA_CLAUDE_COMMAND, version: v.version, source: "env" };
  }
  const cacheFile = cacheDir ? path4.join(cacheDir, "claude-path") : path4.join(process.cwd(), ".sna/claude-path");
  try {
    const cached = fs3.readFileSync(cacheFile, "utf8").trim();
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
  const result = resolveClaudeCli({ cacheDir: path4.join(cwd, ".sna") });
  logger.log("agent", `claude path: ${result.source}=${result.path}${result.version ? ` (${result.version})` : ""}`);
  return result.path;
}
var _ClaudeCodeProcess = class _ClaudeCodeProcess {
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
    proc.on("error", (err2) => {
      this._alive = false;
      this.emitter.emit("error", err2);
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
var ClaudeCodeProcess = _ClaudeCodeProcess;
var ClaudeCodeProvider = class {
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
  spawn(options) {
    const claudeCommand = resolveClaudePath(options.cwd);
    const claudeParts = claudeCommand.split(/\s+/);
    const claudePath = claudeParts[0];
    const claudePrefix = claudeParts.slice(1);
    let pkgRoot = path4.dirname(fileURLToPath(import.meta.url));
    while (!fs3.existsSync(path4.join(pkgRoot, "package.json"))) {
      const parent = path4.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const hookScript = path4.join(pkgRoot, "dist", "scripts", "hook.js");
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
    const cleanEnv = { ...process.env, ...options.env };
    if (options.configDir) {
      cleanEnv.CLAUDE_CONFIG_DIR = options.configDir;
    }
    const omlxUrl = getConfig().omlxBaseUrl;
    if (omlxUrl) {
      cleanEnv.ANTHROPIC_BASE_URL = omlxUrl;
    } else {
      const proxyPort = getConfig().apiProxyPort;
      if (proxyPort) {
        cleanEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
      }
    }
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
    const claudeDir = path4.dirname(claudePath);
    if (claudeDir && claudeDir !== ".") {
      cleanEnv.PATH = `${claudeDir}:${cleanEnv.PATH ?? ""}`;
    }
    const proc = spawn(claudePath, [...claudePrefix, ...args], {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    logger.log("agent", `spawned claude-code (pid=${proc.pid}) \u2192 ${claudeCommand} ${args.join(" ")}`);
    return new ClaudeCodeProcess(proc, options);
  }
};

// src/core/providers/codex.ts
import { spawn as spawn2, execSync as execSync2 } from "child_process";
import { EventEmitter as EventEmitter2 } from "events";
import fs5 from "fs";
import path6 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/history/codex.ts
import fs4 from "fs";
import path5 from "path";
function loadEmbedAsDataUrl(sessionId, record) {
  const fullPath = path5.isAbsolute(record.path) ? record.path : path5.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    const buf = fs4.readFileSync(fullPath);
    return `data:${record.mime_type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
function renderUserContent(content, embeds, sessionId) {
  const out = [];
  for (const seg of splitContentByEmbeds(content)) {
    if (seg.type === "text") {
      if (seg.text.length > 0) out.push({ type: "input_text", text: seg.text });
    } else {
      const record = embeds?.[seg.id];
      if (!record) continue;
      const dataUrl = loadEmbedAsDataUrl(sessionId, record);
      if (!dataUrl) continue;
      out.push({ type: "input_image", image_url: dataUrl });
    }
  }
  return out;
}
function renderAssistantContent(content) {
  return content.length > 0 ? [{ type: "output_text", text: content }] : [];
}
function renderToolOutputContent(content, embeds, sessionId) {
  const segments = splitContentByEmbeds(content);
  const parts = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      parts.push(seg.text);
    } else {
      const record = embeds?.[seg.id];
      if (!record) continue;
      const dataUrl = loadEmbedAsDataUrl(sessionId, record);
      parts.push(dataUrl ? `![](${dataUrl})` : `(missing embed ${seg.id})`);
    }
  }
  return parts.join("");
}
function canonicalToCodexResponseItems(blocks, sessionId) {
  const out = [];
  for (const b of blocks) {
    if (b.actor === "user" && b.kind === "text") {
      const content = renderUserContent(b.content, b.embeds, sessionId);
      if (content.length > 0) out.push({ type: "message", role: "user", content });
      continue;
    }
    if (b.actor === "assistant") {
      if (b.kind === "text") {
        const content = renderAssistantContent(b.content);
        if (content.length > 0) out.push({ type: "message", role: "assistant", content });
      } else if (b.kind === "thinking") {
        if (b.content.length > 0) {
          out.push({
            type: "reasoning",
            summary: [{ type: "summary_text", text: b.content }],
            encrypted_content: b.meta?.signature ?? null
          });
        }
      } else if (b.kind === "tool_use") {
        const callId = b.meta?.id ?? `call_${b.id ?? Math.random().toString(36).slice(2)}`;
        const name = b.content || b.meta?.name || "tool";
        const input = b.meta?.input ?? {};
        out.push({
          type: "function_call",
          name,
          arguments: typeof input === "string" ? input : JSON.stringify(input),
          call_id: callId
        });
      }
      continue;
    }
    if (b.actor === "system" && b.kind === "tool_result") {
      const callId = b.meta?.toolUseId ?? "";
      const output = renderToolOutputContent(b.content, b.embeds, sessionId);
      out.push({ type: "function_call_output", call_id: callId, output });
      continue;
    }
  }
  return out;
}

// src/core/providers/codex.ts
var SHELL2 = process.env.SHELL || "/bin/zsh";
function validateCodexPath(codexPath) {
  try {
    const codexDir = path6.dirname(codexPath);
    const env = { ...process.env, PATH: `${codexDir}:${process.env.PATH ?? ""}` };
    const out = execSync2(`"${codexPath}" --version`, {
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
  const dir = cacheDir ?? path6.join(process.cwd(), ".sna");
  try {
    if (!fs5.existsSync(dir)) fs5.mkdirSync(dir, { recursive: true });
    fs5.writeFileSync(path6.join(dir, "codex-path"), codexPath);
  } catch {
  }
}
function resolveCodexCli(opts) {
  const cacheDir = opts?.cacheDir;
  if (process.env.SNA_CODEX_COMMAND) {
    const v = validateCodexPath(process.env.SNA_CODEX_COMMAND);
    return { path: process.env.SNA_CODEX_COMMAND, version: v.version, source: "env" };
  }
  const cacheFile = cacheDir ? path6.join(cacheDir, "codex-path") : path6.join(process.cwd(), ".sna/codex-path");
  try {
    const cached = fs5.readFileSync(cacheFile, "utf8").trim();
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
    const raw = execSync2(`${SHELL2} -i -l -c "command -v codex" 2>/dev/null`, {
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
  const result = resolveCodexCli({ cacheDir: path6.join(cwd, ".sna") });
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
    this.emitter = new EventEmitter2();
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
        } catch (err2) {
          logger.log("agent", `codex: failed to enable thread/resume.history feature: ${err2}`);
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
    const codexHome = options.configDir ?? path6.join(options.cwd, ".sna", "codex-home");
    if (!fs5.existsSync(codexHome)) {
      fs5.mkdirSync(codexHome, { recursive: true });
    }
    const realCodexHome = `${process.env.HOME}/.codex`;
    for (const f of ["auth.json", "installation_id"]) {
      const src = path6.join(realCodexHome, f);
      const dst = path6.join(codexHome, f);
      if (fs5.existsSync(src) && !fs5.existsSync(dst)) {
        fs5.copyFileSync(src, dst);
      }
    }
    const configTomlPath = path6.join(codexHome, "config.toml");
    if (!fs5.existsSync(configTomlPath)) {
      const realConfig = path6.join(realCodexHome, "config.toml");
      if (fs5.existsSync(realConfig)) {
        fs5.copyFileSync(realConfig, configTomlPath);
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
      fs5.appendFileSync(configTomlPath, "\n" + tomlLines.join("\n"));
      logger.log("agent", `codex: ${Object.keys(options.mcpServers).length} MCP servers injected`);
    }
    let pkgRoot = path6.dirname(fileURLToPath2(import.meta.url));
    while (!fs5.existsSync(path6.join(pkgRoot, "package.json"))) {
      const parent = path6.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const preToolUseHooks = [];
    if (options.permissionMode !== "bypassPermissions") {
      const hookScript = path6.join(pkgRoot, "dist", "scripts", "hook.js");
      const sessionId = options.env?.SNA_SESSION_ID ?? "default";
      preToolUseHooks.push({
        type: "command",
        command: `node "${hookScript}" --session=${sessionId}`,
        timeout: 300
      });
      logger.log("agent", `codex: permission hook \u2192 ${hookScript} --session=${sessionId}`);
    }
    if (options.allowedTools?.length || options.disallowedTools?.length) {
      const filterScript = path6.join(pkgRoot, "dist", "scripts", "tool-filter.js");
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
      fs5.writeFileSync(path6.join(codexHome, "hooks.json"), JSON.stringify(hooksJson));
      const existingConfig = fs5.readFileSync(configTomlPath, "utf8");
      if (!existingConfig.includes("codex_hooks")) {
        fs5.appendFileSync(configTomlPath, "\n[features]\ncodex_hooks = true\n");
      }
    }
    logger.log("agent", `codex: CODEX_HOME=${codexHome}`);
    const codexDir = path6.dirname(codexPath);
    if (codexDir && codexDir !== ".") {
      cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
    }
    const resumeInfo = extractResumeArg(options.extraArgs);
    const sysInfo = extractSystemPromptArgs(resumeInfo ? resumeInfo.cleanArgs : options.extraArgs);
    if (sysInfo.cleanArgs.length) {
      args.push(...sysInfo.cleanArgs);
    }
    const proc = spawn2(codexPath, args, {
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
  "codex": new CodexProvider(),
  "omlx": new ClaudeCodeProvider()
};
function getProvider(name = "claude-code") {
  const provider2 = providers[name];
  if (!provider2) throw new Error(`Unknown agent provider: ${name}`);
  return provider2;
}

// src/db/schema.ts
import { createRequire } from "module";
import fs6 from "fs";
import path7 from "path";
function getDbPath() {
  return process.env.SNA_DB_PATH ?? path7.join(process.cwd(), "data/sna.db");
}
var NATIVE_DIR = path7.join(process.cwd(), ".sna/native");
var _db = null;
function loadBetterSqlite3() {
  const modulesPath = process.env.SNA_MODULES_PATH;
  if (modulesPath) {
    const entry = path7.join(modulesPath, "better-sqlite3");
    if (fs6.existsSync(entry)) {
      const req2 = createRequire(path7.join(modulesPath, "noop.js"));
      return req2("better-sqlite3");
    }
  }
  const nativeEntry = path7.join(NATIVE_DIR, "node_modules", "better-sqlite3");
  if (fs6.existsSync(nativeEntry)) {
    const req2 = createRequire(path7.join(NATIVE_DIR, "noop.js"));
    return req2("better-sqlite3");
  }
  const req = createRequire(import.meta.url);
  return req("better-sqlite3");
}
function getDb() {
  if (!_db) {
    const BetterSqlite3 = loadBetterSqlite3();
    const dir = path7.dirname(getDbPath());
    if (!fs6.existsSync(dir)) fs6.mkdirSync(dir, { recursive: true });
    const nativeBinding = process.env.SNA_SQLITE_NATIVE_BINDING || void 0;
    _db = nativeBinding ? new BetterSqlite3(getDbPath(), { nativeBinding }) : new BetterSqlite3(getDbPath());
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
  }
  return _db;
}
function dropLegacySkillEvents(db) {
  db.exec("DROP TABLE IF EXISTS skill_events");
}
function migrateChatSessionsMeta(db) {
  const cols = db.prepare("PRAGMA table_info(chat_sessions)").all();
  if (cols.length > 0 && !cols.some((c) => c.name === "meta")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN meta TEXT");
  }
  if (cols.length > 0 && !cols.some((c) => c.name === "cwd")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN cwd TEXT");
  }
  if (cols.length > 0 && !cols.some((c) => c.name === "last_start_config")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN last_start_config TEXT");
  }
}
function migrateChatMessagesCanonical(db) {
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all();
  if (cols.length === 0) return;
  const hasRole = cols.some((c) => c.name === "role");
  const hasActor = cols.some((c) => c.name === "actor");
  const hasKind = cols.some((c) => c.name === "kind");
  const hasEmbeds = cols.some((c) => c.name === "embeds");
  const hasUpdatedAt = cols.some((c) => c.name === "updated_at");
  if (!hasRole && hasActor && hasKind && hasEmbeds && hasUpdatedAt) return;
  db.transaction(() => {
    if (!hasActor) db.exec("ALTER TABLE chat_messages ADD COLUMN actor TEXT");
    if (!hasKind) db.exec("ALTER TABLE chat_messages ADD COLUMN kind TEXT");
    if (!hasEmbeds) db.exec("ALTER TABLE chat_messages ADD COLUMN embeds TEXT");
    if (!hasUpdatedAt) db.exec("ALTER TABLE chat_messages ADD COLUMN updated_at TEXT");
    if (hasRole) {
      db.exec(`
        UPDATE chat_messages SET
          actor = CASE role
            WHEN 'user' THEN 'user'
            WHEN 'assistant' THEN 'assistant'
            WHEN 'thinking' THEN 'assistant'
            WHEN 'tool' THEN 'assistant'
            WHEN 'tool_use' THEN 'assistant'
            WHEN 'tool_result' THEN 'system'
            WHEN 'status' THEN 'system'
            WHEN 'error' THEN 'system'
            ELSE 'system'
          END,
          kind = CASE role
            WHEN 'user' THEN 'text'
            WHEN 'assistant' THEN 'text'
            WHEN 'thinking' THEN 'thinking'
            WHEN 'tool' THEN 'tool_use'
            WHEN 'tool_use' THEN 'tool_use'
            WHEN 'tool_result' THEN 'tool_result'
            WHEN 'status' THEN 'status'
            WHEN 'error' THEN 'error'
            ELSE 'text'
          END
        WHERE actor IS NULL OR kind IS NULL;
      `);
    }
    db.exec(`UPDATE chat_messages SET updated_at = created_at WHERE updated_at IS NULL`);
    const legacyImageRows = db.prepare(`
      SELECT id, content, meta FROM chat_messages
      WHERE meta IS NOT NULL AND meta LIKE '%"images"%' AND embeds IS NULL
    `).all();
    const updateEmbeds = db.prepare(`UPDATE chat_messages SET content = ?, embeds = ?, meta = ? WHERE id = ?`);
    for (const row of legacyImageRows) {
      try {
        const meta = JSON.parse(row.meta);
        const files = Array.isArray(meta.images) ? meta.images.filter((f) => typeof f === "string") : [];
        if (files.length === 0) continue;
        const embedEntries = {};
        const refsSuffix = [];
        for (const filename of files) {
          const id = filename.replace(/\.[^.]+$/, "");
          const ext = filename.match(/\.([^.]+)$/)?.[1] ?? "";
          embedEntries[id] = { mime_type: extToMime(ext), path: filename };
          refsSuffix.push(`![](embed://${id})`);
        }
        const newContent = row.content + (refsSuffix.length > 0 ? "\n" + refsSuffix.join(" ") : "");
        delete meta.images;
        const newMeta = Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        updateEmbeds.run(newContent, JSON.stringify(embedEntries), newMeta, row.id);
      } catch {
      }
    }
    if (hasRole) {
      db.exec("ALTER TABLE chat_messages DROP COLUMN role");
    }
  })();
}
function migrateDropSkillName(db) {
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all();
  if (cols.length === 0) return;
  if (cols.some((c) => c.name === "skill_name")) {
    db.exec("ALTER TABLE chat_messages DROP COLUMN skill_name");
  }
}
function extToMime(ext) {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
function initSchema(db) {
  dropLegacySkillEvents(db);
  migrateChatSessionsMeta(db);
  migrateChatMessagesCanonical(db);
  migrateDropSkillName(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'main',
      meta       TEXT,
      cwd        TEXT,
      last_start_config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Ensure default session always exists
    INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES ('default', 'Chat', 'main');

    -- Canonical chat_messages schema. Two orthogonal axes describe each block:
    --   actor  WHO produced it:    'user' | 'assistant' | 'system'
    --   kind   WHAT kind it is:    'text' | 'thinking' | 'tool_use' | 'tool_result' | 'status' | 'error'
    --   content Textual body. May contain inline embed refs: ![](embed://<id>)
    --   embeds  JSON { "<id>": { mime_type, path, ... } } \u2014 binary attachments referenced by content.
    --   meta    Kind-specific structured overlay (usage, tool_use_id, input JSON, isError, ...)
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      actor      TEXT NOT NULL DEFAULT 'user',
      kind       TEXT NOT NULL DEFAULT 'text',
      content    TEXT NOT NULL DEFAULT '',
      embeds     TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_kind ON chat_messages(session_id, kind);
  `);
}

// src/history/canonical.ts
function buildCanonicalFromDb(sessionId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, actor, kind, content, embeds, meta, created_at
       FROM chat_messages
      WHERE session_id = ?
      ORDER BY id ASC`
  ).all(sessionId);
  const out = [];
  for (const r of rows) {
    if (r.kind === "status" || r.kind === "error") continue;
    let embeds;
    if (r.embeds) {
      try {
        embeds = JSON.parse(r.embeds);
      } catch {
      }
    }
    let meta;
    if (r.meta) {
      try {
        meta = JSON.parse(r.meta);
      } catch {
      }
    }
    out.push({
      id: r.id,
      actor: r.actor,
      kind: r.kind,
      content: r.content,
      embeds,
      meta,
      createdAt: r.created_at
    });
  }
  return out;
}

// src/server/api-types.ts
function httpJson(c, _op, data, status) {
  return c.json(data, status);
}
function wsReply(ws, msg, data) {
  if (ws.readyState !== ws.OPEN) return;
  const out = { ...data, type: msg.type };
  if (msg.rid != null) out.rid = msg.rid;
  ws.send(JSON.stringify(out));
}

// src/server/image-store.ts
import fs7 from "fs";
import path8 from "path";
import { createHash } from "crypto";
function getImageDir() {
  return path8.join(getConfig().dataDir, "images");
}
var MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf"
};
function saveEmbeds(sessionId, attachments) {
  const dir = path8.join(getImageDir(), sessionId);
  fs7.mkdirSync(dir, { recursive: true });
  return attachments.map((att) => {
    const ext = MIME_TO_EXT[att.mimeType] ?? "bin";
    const id = createHash("sha256").update(att.base64).digest("hex").slice(0, 12);
    const filename = `${id}.${ext}`;
    const filePath = path8.join(dir, filename);
    if (!fs7.existsSync(filePath)) {
      fs7.writeFileSync(filePath, Buffer.from(att.base64, "base64"));
    }
    return {
      id,
      record: { mime_type: att.mimeType, path: filename }
    };
  });
}
function resolveImagePath(sessionId, filename) {
  if (filename.includes("..") || filename.includes("/")) return null;
  const filePath = path8.join(getImageDir(), sessionId, filename);
  return fs7.existsSync(filePath) ? filePath : null;
}

// src/db/chat-messages.ts
function insertChatMessage(db, msg) {
  const embedsJson = msg.embeds && Object.keys(msg.embeds).length > 0 ? JSON.stringify(msg.embeds) : null;
  const metaJson = msg.meta && Object.keys(msg.meta).length > 0 ? JSON.stringify(msg.meta) : null;
  const result = db.prepare(
    `INSERT INTO chat_messages (session_id, actor, kind, content, embeds, meta)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    msg.sessionId,
    msg.actor,
    msg.kind,
    msg.content,
    embedsJson,
    metaJson
  );
  return Number(result.lastInsertRowid);
}
function updateChatMessageMeta(db, id, meta) {
  db.prepare(
    `UPDATE chat_messages SET meta = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(meta), id);
}

// src/core/completion.ts
import { spawn as spawn3 } from "child_process";

// src/lib/langfuse-tracer.ts
var langfuseClient = null;
var _userId;
var _userEmail;
var _baseTags = [];
function logError(msg) {
  logger.err("err", `[langfuse] ${msg}`);
}
function traceCompletion(opts) {
  if (!langfuseClient) return null;
  try {
    const trace = langfuseClient.trace({
      name: opts.label,
      userId: _userEmail ?? _userId,
      input: opts.input,
      tags: [..._baseTags, opts.label]
    });
    const generation = trace.generation({
      name: "completion",
      model: opts.model,
      input: opts.input
    });
    return {
      end(result) {
        generation.update({
          output: result.text,
          model: result.model,
          usage: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
            total: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)
          }
        });
        generation.end();
        trace.update({
          output: result.text,
          metadata: { costUsd: result.costUsd, durationMs: result.durationMs, model: result.model, usage: result.usage }
        });
        langfuseClient?.flushAsync?.().catch(() => {
        });
      },
      error(err2) {
        generation.update({ output: `[ERROR] ${err2.message}`, level: "ERROR" });
        generation.end();
        trace.update({ output: `[ERROR] ${err2.message}` });
        langfuseClient?.flushAsync?.().catch(() => {
        });
      }
    };
  } catch (err2) {
    logError(`traceCompletion failed: ${err2}`);
    return null;
  }
}

// src/core/completion.ts
async function completion(opts) {
  const providerName = opts.provider ?? getConfig().defaultProvider;
  if (providerName === "codex") {
    return completionCodex(opts);
  }
  return completionClaudeCode(opts);
}
function completionClaudeCode(opts) {
  const cwd = opts.cwd ?? process.cwd();
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
  const model = opts.model ?? getConfig().model;
  if (model) args.push("--model", model);
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  args.push(opts.prompt);
  const cleanEnv = { ...process.env, ...opts.env };
  const proxyPort = getConfig().apiProxyPort;
  if (proxyPort) {
    cleanEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  }
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
  const label = opts.label ?? "completion";
  const timeout = opts.timeout ?? 6e4;
  logger.log("agent", `completion: ${label} provider=claude-code model=${model ?? "default"} prompt="${opts.prompt.slice(0, 60)}..."`);
  const trace = traceCompletion({ label, model, input: opts.prompt });
  return new Promise((resolve, reject) => {
    const proc = spawn3(claudePath, args, {
      cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      const err2 = new Error(`completion timed out after ${timeout}ms`);
      trace?.error(err2);
      reject(err2);
    }, timeout);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err2) => {
      clearTimeout(timer);
      trace?.error(err2);
      reject(new Error(`completion spawn error: ${err2.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        const err2 = new Error(`completion: failed to parse JSON (code=${code}): ${stdout.slice(0, 200)} ${stderr.slice(0, 200)}`);
        trace?.error(err2);
        reject(err2);
        return;
      }
      if (parsed.is_error) {
        const err2 = new Error(`completion error: ${parsed.result}`);
        trace?.error(err2);
        reject(err2);
        return;
      }
      const modelKey = Object.keys(parsed.modelUsage)[0] ?? model ?? "unknown";
      const result = {
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
      };
      logger.log("agent", `completion done: ${label} ${result.durationMs}ms cost=$${result.costUsd.toFixed(4)} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
      trace?.end(result);
      resolve(result);
    });
    proc.stdin.end();
  });
}
function completionCodex(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const resolved = resolveCodexCli();
  const codexPath = resolved.path;
  const args = ["exec", "--json", "--ephemeral", "--full-auto"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  const instructions = [opts.systemPrompt, opts.appendSystemPrompt].filter(Boolean).join("\n\n");
  if (instructions) {
    args.push("-c", `developer_instructions=${JSON.stringify(instructions)}`);
  }
  const prompt = opts.prompt;
  args.push(prompt);
  const cleanEnv = { ...process.env, ...opts.env };
  const codexDir = codexPath.includes("/") ? codexPath.slice(0, codexPath.lastIndexOf("/")) : "";
  if (codexDir && codexDir !== ".") {
    cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
  }
  const label = opts.label ?? "completion";
  const timeout = opts.timeout ?? 6e4;
  const model = opts.model ?? "codex-default";
  logger.log("agent", `completion: ${label} provider=codex model=${model} prompt="${opts.prompt.slice(0, 60)}..."`);
  const trace = traceCompletion({ label, model, input: opts.prompt });
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const proc = spawn3(codexPath, args, {
      cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      const err2 = new Error(`completion timed out after ${timeout}ms`);
      trace?.error(err2);
      reject(err2);
    }, timeout);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err2) => {
      clearTimeout(timer);
      trace?.error(err2);
      reject(new Error(`completion spawn error: ${err2.message}`));
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
        const err2 = new Error(`completion error: ${errorEvent.error?.message ?? "unknown"}`);
        trace?.error(err2);
        reject(err2);
        return;
      }
      if (!text && code !== 0) {
        const err2 = new Error(`completion: codex exited with code ${code}: ${stderr.slice(0, 200)}`);
        trace?.error(err2);
        reject(err2);
        return;
      }
      const result = {
        text,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cached_input_tokens,
          cacheCreationTokens: 0
        },
        costUsd: 0,
        // Codex doesn't return cost
        durationMs,
        durationApiMs: durationMs,
        // no separate API duration
        model: model ?? "codex"
      };
      logger.log("agent", `completion done: ${label} ${result.durationMs}ms in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
      trace?.end(result);
      resolve(result);
    });
  });
}

// src/server/routes/agent.ts
function getSessionId(c) {
  return c.req.query("session") ?? "default";
}
async function runOnce(sessionManager2, opts) {
  const sessionId = `run-once-${crypto.randomUUID().slice(0, 8)}`;
  const timeout = opts.timeout ?? getConfig().runOnceTimeoutMs;
  const session = sessionManager2.createSession({
    id: sessionId,
    label: "run-once",
    cwd: opts.cwd ?? process.cwd()
  });
  const cfg = getConfig();
  const provider2 = getProvider(opts.provider ?? cfg.defaultProvider);
  const extraArgs = opts.extraArgs ? [...opts.extraArgs] : [];
  if (opts.systemPrompt) extraArgs.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) extraArgs.push("--append-system-prompt", opts.appendSystemPrompt);
  const proc = provider2.spawn({
    cwd: session.cwd,
    prompt: opts.message,
    model: opts.model ?? cfg.model,
    permissionMode: opts.permissionMode ?? cfg.defaultPermissionMode,
    env: { ...opts.env, SNA_SESSION_ID: sessionId },
    extraArgs
  });
  sessionManager2.setProcess(sessionId, proc);
  try {
    const result = await new Promise((resolve, reject) => {
      const texts = [];
      let usage = null;
      const timer = setTimeout(() => {
        reject(new Error(`run-once timed out after ${timeout}ms`));
      }, timeout);
      const unsub = sessionManager2.onSessionEvent(sessionId, (_cursor, e) => {
        if (e.type === "assistant" && e.message) {
          texts.push(e.message);
        }
        if (e.type === "complete") {
          clearTimeout(timer);
          unsub();
          usage = e.data ?? null;
          resolve({ result: texts.join("\n"), usage });
        }
        if (e.type === "error") {
          clearTimeout(timer);
          unsub();
          reject(new Error(e.message ?? "Agent error"));
        }
      });
    });
    return result;
  } finally {
    sessionManager2.killSession(sessionId);
    sessionManager2.removeSession(sessionId);
  }
}
function createAgentRoutes(sessionManager2) {
  const app = new Hono();
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const session = sessionManager2.createSession({
        id: body.id,
        label: body.label,
        cwd: body.cwd,
        meta: body.meta
      });
      logger.log("route", `POST /sessions \u2192 created "${session.id}"`);
      return httpJson(c, "sessions.create", { status: "created", sessionId: session.id, label: session.label, meta: session.meta });
    } catch (e) {
      logger.err("err", `POST /sessions \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 409);
    }
  });
  app.get("/sessions", (c) => {
    return httpJson(c, "sessions.list", { sessions: sessionManager2.listSessions() });
  });
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot remove default session" }, 400);
    }
    const removed = sessionManager2.removeSession(id);
    if (!removed) {
      return c.json({ status: "error", message: "Session not found" }, 404);
    }
    logger.log("route", `DELETE /sessions/${id} \u2192 removed`);
    return httpJson(c, "sessions.remove", { status: "removed" });
  });
  app.patch("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    try {
      sessionManager2.updateSession(id, {
        label: body.label,
        meta: body.meta,
        cwd: body.cwd
      });
      logger.log("route", `PATCH /sessions/${id} \u2192 updated`);
      return httpJson(c, "sessions.update", { status: "updated", session: id });
    } catch (e) {
      logger.err("err", `PATCH /sessions/${id} \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 404);
    }
  });
  app.post("/run-once", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.message) {
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    try {
      const result = await runOnce(sessionManager2, body);
      return httpJson(c, "agent.run-once", result);
    } catch (e) {
      logger.err("err", `POST /run-once \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/completion", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.prompt) {
      return c.json({ status: "error", message: "prompt is required" }, 400);
    }
    try {
      const result = await completion(body);
      return httpJson(c, "agent.completion", result);
    } catch (e) {
      logger.err("err", `POST /completion \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/start", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const session = sessionManager2.getOrCreateSession(sessionId, {
      cwd: body.cwd
    });
    if (session.process?.alive && !body.force) {
      logger.log("route", `POST /start?session=${sessionId} \u2192 already_running`);
      return httpJson(c, "agent.start", {
        status: "already_running",
        provider: getConfig().defaultProvider,
        sessionId: session.process.sessionId ?? session.id
      });
    }
    if (session.process?.alive) {
      session.process.kill();
    }
    const provider2 = getProvider(body.provider ?? getConfig().defaultProvider);
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
      if (body.prompt) {
        insertChatMessage(db, {
          sessionId,
          actor: "user",
          kind: "text",
          content: body.prompt,
          meta: body.meta
        });
      }
    } catch {
    }
    const providerName = body.provider ?? getConfig().defaultProvider;
    const model = body.model ?? getConfig().model;
    const permissionMode2 = body.permissionMode;
    const configDir = body.configDir;
    const extraArgs = body.extraArgs;
    try {
      const proc = provider2.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode: permissionMode2,
        configDir,
        env: { ...body.env, SNA_SESSION_ID: sessionId },
        history: body.history,
        extraArgs,
        providerOptions: body.providerOptions,
        systemPrompt: body.systemPrompt,
        appendSystemPrompt: body.appendSystemPrompt,
        allowedTools: body.allowedTools,
        disallowedTools: body.disallowedTools,
        mcpServers: body.mcpServers
      });
      sessionManager2.setProcess(sessionId, proc);
      sessionManager2.saveStartConfig(sessionId, { provider: providerName, modelProvider: body.modelProvider, model, permissionMode: permissionMode2, configDir, extraArgs, providerOptions: body.providerOptions });
      logger.log("route", `POST /start?session=${sessionId} \u2192 started`);
      return httpJson(c, "agent.start", {
        status: "started",
        provider: provider2.name,
        sessionId: session.id
      });
    } catch (e) {
      logger.err("err", `POST /start?session=${sessionId} failed: ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/send", async (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager2.getSession(sessionId);
    if (!session?.process?.alive) {
      logger.err("err", `POST /send?session=${sessionId} \u2192 no active session`);
      return c.json(
        { status: "error", message: `No active agent session "${sessionId}". Call POST /start first.` },
        400
      );
    }
    const body = await c.req.json().catch(() => ({}));
    if (!body.message && !body.images?.length) {
      logger.err("err", `POST /send?session=${sessionId} \u2192 empty message`);
      return c.json({ status: "error", message: "message or images required" }, 400);
    }
    const userText = body.message ?? "";
    const meta = body.meta ? { ...body.meta } : {};
    const embeds = {};
    let contentText = userText;
    if (body.images?.length) {
      const saved = saveEmbeds(sessionId, body.images);
      const refs = saved.map(({ id, record }) => {
        embeds[id] = record;
        return formatEmbedRef(id);
      });
      contentText = userText ? `${userText}
${refs.join(" ")}` : refs.join(" ");
    }
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
      insertChatMessage(db, {
        sessionId,
        actor: "user",
        kind: "text",
        content: contentText,
        embeds: Object.keys(embeds).length > 0 ? embeds : void 0,
        meta: Object.keys(meta).length > 0 ? meta : void 0
      });
    } catch {
    }
    sessionManager2.pushEvent(sessionId, {
      type: "user_message",
      message: contentText,
      data: Object.keys(meta).length > 0 ? meta : void 0,
      timestamp: Date.now()
    });
    sessionManager2.updateSessionState(sessionId, "processing");
    sessionManager2.touch(sessionId);
    if (body.images?.length) {
      const content = [
        ...body.images.map((img) => ({
          type: "image",
          source: { type: "base64", media_type: img.mimeType, data: img.base64 }
        })),
        ...body.message ? [{ type: "text", text: body.message }] : []
      ];
      logger.log("route", `POST /send?session=${sessionId} \u2192 ${body.images.length} image(s) + "${(body.message ?? "").slice(0, 40)}"`);
      session.process.send(content);
    } else {
      logger.log("route", `POST /send?session=${sessionId} \u2192 "${body.message.slice(0, 80)}"`);
      session.process.send(body.message);
    }
    return httpJson(c, "agent.send", { status: "sent" });
  });
  app.get("/events", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager2.getOrCreateSession(sessionId);
    const sinceParam = c.req.query("since");
    const sinceCursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;
    return streamSSE(c, async (stream) => {
      const KEEPALIVE_MS = getConfig().keepaliveIntervalMs;
      const signal = c.req.raw.signal;
      const queue = [];
      let wakeUp = null;
      const unsub = sessionManager2.onSessionEvent(sessionId, (eventCursor, event) => {
        queue.push({ cursor: eventCursor, event });
        const fn = wakeUp;
        wakeUp = null;
        fn?.();
      });
      signal.addEventListener("abort", () => {
        const fn = wakeUp;
        wakeUp = null;
        fn?.();
      });
      try {
        let cursor = sinceCursor;
        if (cursor < session.eventCounter) {
          const startIdx = Math.max(
            0,
            session.eventBuffer.length - (session.eventCounter - cursor)
          );
          for (const event of session.eventBuffer.slice(startIdx)) {
            cursor++;
            await stream.writeSSE({ id: String(cursor), data: JSON.stringify(event) });
          }
        } else {
          cursor = session.eventCounter;
        }
        while (queue.length > 0 && queue[0].cursor !== -1 && queue[0].cursor <= cursor) queue.shift();
        while (!signal.aborted) {
          if (queue.length === 0) {
            await Promise.race([
              new Promise((r) => {
                wakeUp = r;
              }),
              new Promise((r) => setTimeout(r, KEEPALIVE_MS))
            ]);
          }
          if (signal.aborted) break;
          if (queue.length > 0) {
            while (queue.length > 0) {
              const item = queue.shift();
              if (item.cursor === -1) {
                await stream.writeSSE({ data: JSON.stringify(item.event) });
              } else {
                await stream.writeSSE({ id: String(item.cursor), data: JSON.stringify(item.event) });
              }
            }
          } else {
            await stream.writeSSE({ data: "" });
          }
        }
      } finally {
        unsub();
      }
    });
  });
  app.post("/restart", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    try {
      const session = sessionManager2.getSession(sessionId);
      const prevProvider = session?.lastStartConfig?.provider;
      const ccSessionId = session?.ccSessionId;
      const { config } = sessionManager2.restartSession(sessionId, body, (cfg) => {
        const prov = getProvider(cfg.provider);
        const providerChanged = prevProvider && cfg.provider !== prevProvider;
        const typedOpts = {
          systemPrompt: body.systemPrompt,
          appendSystemPrompt: body.appendSystemPrompt,
          allowedTools: body.allowedTools,
          disallowedTools: body.disallowedTools,
          mcpServers: body.mcpServers
        };
        if (providerChanged) {
          const history = buildCanonicalFromDb(sessionId);
          logger.log("route", `restart: provider changed ${prevProvider} \u2192 ${cfg.provider}, using DB history (${history.length} msgs)`);
          return prov.spawn({
            cwd: sessionManager2.getSession(sessionId).cwd,
            model: cfg.model,
            permissionMode: cfg.permissionMode,
            configDir: cfg.configDir,
            env: { ...body.env, SNA_SESSION_ID: sessionId },
            history: history.length > 0 ? history : void 0,
            extraArgs: cfg.extraArgs,
            providerOptions: cfg.providerOptions,
            ...typedOpts
          });
        }
        return prov.spawn({
          cwd: sessionManager2.getSession(sessionId).cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          configDir: cfg.configDir,
          env: { ...body.env, SNA_SESSION_ID: sessionId },
          resumeSessionId: ccSessionId ?? void 0,
          extraArgs: cfg.extraArgs,
          providerOptions: cfg.providerOptions,
          ...typedOpts
        });
      });
      logger.log("route", `POST /restart?session=${sessionId} \u2192 restarted (${config.provider})`);
      return httpJson(c, "agent.restart", {
        status: "restarted",
        provider: config.provider,
        sessionId
      });
    } catch (e) {
      logger.err("err", `POST /restart?session=${sessionId} \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/resume", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const session = sessionManager2.getOrCreateSession(sessionId);
    if (session.process?.alive) {
      return c.json({ status: "error", message: "Session already running. Use agent.send instead." }, 400);
    }
    const history = buildCanonicalFromDb(sessionId);
    if (history.length === 0 && !body.prompt) {
      return c.json({ status: "error", message: "No history in DB \u2014 nothing to resume." }, 400);
    }
    const providerName = body.provider ?? getConfig().defaultProvider;
    const providerChanged = session.lastStartConfig && session.lastStartConfig.provider !== providerName;
    const model = body.model ?? session.lastStartConfig?.model ?? getConfig().model;
    const permissionMode2 = body.permissionMode ?? session.lastStartConfig?.permissionMode;
    const configDir = providerChanged ? body.configDir : body.configDir ?? session.lastStartConfig?.configDir;
    const extraArgs = providerChanged ? body.extraArgs : body.extraArgs ?? session.lastStartConfig?.extraArgs;
    const providerOptions = providerChanged ? body.providerOptions : body.providerOptions ?? session.lastStartConfig?.providerOptions;
    const modelProvider = body.modelProvider ?? (providerChanged ? void 0 : session.lastStartConfig?.modelProvider);
    const provider2 = getProvider(providerName);
    try {
      const proc = provider2.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode: permissionMode2,
        configDir,
        env: { ...body.env, SNA_SESSION_ID: sessionId },
        history: history.length > 0 ? history : void 0,
        extraArgs,
        providerOptions,
        systemPrompt: body.systemPrompt,
        appendSystemPrompt: body.appendSystemPrompt,
        allowedTools: body.allowedTools,
        disallowedTools: body.disallowedTools,
        mcpServers: body.mcpServers
      });
      sessionManager2.setProcess(sessionId, proc, "resumed");
      sessionManager2.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode: permissionMode2, configDir, extraArgs, providerOptions });
      logger.log("route", `POST /resume?session=${sessionId} \u2192 resumed (${history.length} history msgs)`);
      return httpJson(c, "agent.resume", {
        status: "resumed",
        provider: providerName,
        sessionId: session.id,
        historyCount: history.length
      });
    } catch (e) {
      logger.err("err", `POST /resume?session=${sessionId} \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/interrupt", async (c) => {
    const sessionId = getSessionId(c);
    const interrupted = sessionManager2.interruptSession(sessionId);
    return httpJson(c, "agent.interrupt", { status: interrupted ? "interrupted" : "no_session" });
  });
  app.post("/set-model", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    if (!body.model) return c.json({ status: "error", message: "model is required" }, 400);
    const updated = sessionManager2.setSessionModel(sessionId, body.model);
    return httpJson(c, "agent.set-model", { status: updated ? "updated" : "no_session", model: body.model });
  });
  app.post("/set-permission-mode", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    if (!body.permissionMode) return c.json({ status: "error", message: "permissionMode is required" }, 400);
    const updated = sessionManager2.setSessionPermissionMode(sessionId, body.permissionMode);
    return httpJson(c, "agent.set-permission-mode", { status: updated ? "updated" : "no_session", permissionMode: body.permissionMode });
  });
  app.post("/kill", async (c) => {
    const sessionId = getSessionId(c);
    const killed = sessionManager2.killSession(sessionId);
    return httpJson(c, "agent.kill", { status: killed ? "killed" : "no_session" });
  });
  app.get("/status", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager2.getSession(sessionId);
    const alive = session?.process?.alive ?? false;
    let messageCount = 0;
    let lastMessage = null;
    try {
      const db = getDb();
      const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId);
      messageCount = count?.c ?? 0;
      const last = db.prepare("SELECT actor, kind, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId);
      if (last) lastMessage = { actor: last.actor, kind: last.kind, content: last.content, created_at: last.created_at };
    } catch {
    }
    return httpJson(c, "agent.status", {
      alive,
      agentStatus: !alive ? "disconnected" : session?.state === "processing" ? "busy" : "idle",
      sessionId: session?.process?.sessionId ?? null,
      ccSessionId: session?.ccSessionId ?? null,
      eventCount: session?.eventCounter ?? 0,
      messageCount,
      lastMessage,
      config: session?.lastStartConfig ?? null
    });
  });
  app.post("/permission-request", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    logger.log("route", `POST /permission-request?session=${sessionId} \u2192 ${body.tool_name}`);
    const result = await sessionManager2.createPendingPermission(sessionId, body);
    return c.json({ approved: result });
  });
  app.post("/permission-respond", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const approved = body.approved ?? false;
    const resolved = sessionManager2.resolvePendingPermission(sessionId, approved);
    if (!resolved) {
      return c.json({ status: "error", message: "No pending permission request" }, 404);
    }
    logger.log("route", `POST /permission-respond?session=${sessionId} \u2192 ${approved ? "approved" : "denied"}`);
    return httpJson(c, "permission.respond", { status: approved ? "approved" : "denied" });
  });
  app.get("/permission-pending", (c) => {
    const sessionId = c.req.query("session");
    if (sessionId) {
      const pending = sessionManager2.getPendingPermission(sessionId);
      return httpJson(c, "permission.pending", { pending: pending ? [{ sessionId, ...pending }] : [] });
    }
    return httpJson(c, "permission.pending", { pending: sessionManager2.getAllPendingPermissions() });
  });
  return app;
}

// src/server/routes/chat.ts
import { Hono as Hono2 } from "hono";
import fs8 from "fs";
function createChatRoutes() {
  const app = new Hono2();
  app.get("/sessions", (c) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, type, meta, cwd, created_at FROM chat_sessions ORDER BY created_at DESC`
      ).all();
      const sessions = rows.map((r) => ({
        ...r,
        meta: r.meta ? JSON.parse(r.meta) : null
      }));
      return httpJson(c, "chat.sessions.list", { sessions });
    } catch (e) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  });
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = body.id ?? crypto.randomUUID().slice(0, 8);
    const sessionType = body.type ?? body.chatType ?? "background";
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`
      ).run(id, body.label ?? id, sessionType, body.meta ? JSON.stringify(body.meta) : null);
      return httpJson(c, "chat.sessions.create", { status: "created", id, meta: body.meta ?? null });
    } catch (e) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot delete default session" }, 400);
    }
    try {
      const db = getDb();
      db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
      return httpJson(c, "chat.sessions.remove", { status: "deleted" });
    } catch (e) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.get("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const sinceParam = c.req.query("since");
    const limitParam = c.req.query("limit");
    try {
      const db = getDb();
      let sql = `SELECT * FROM chat_messages WHERE session_id = ?`;
      const params = [id];
      if (sinceParam) {
        sql += ` AND id > ?`;
        params.push(parseInt(sinceParam, 10));
      }
      sql += ` ORDER BY id ASC`;
      if (limitParam) {
        sql += ` LIMIT ?`;
        params.push(parseInt(limitParam, 10));
      }
      const messages = db.prepare(sql).all(...params);
      return httpJson(c, "chat.messages.list", { messages });
    } catch (e) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  });
  app.post("/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    if (!body.actor || !body.kind) {
      return c.json({ status: "error", message: "actor and kind are required" }, 400);
    }
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, sessionId);
      const id = insertChatMessage(db, {
        sessionId,
        actor: body.actor,
        kind: body.kind,
        content: body.content ?? "",
        embeds: body.embeds,
        meta: body.meta
      });
      return httpJson(c, "chat.messages.create", { status: "created", id });
    } catch (e) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.delete("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    try {
      const db = getDb();
      db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
      return httpJson(c, "chat.messages.clear", { status: "cleared" });
    } catch (e) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.get("/images/:sessionId/:filename", (c) => {
    const sessionId = c.req.param("sessionId");
    const filename = c.req.param("filename");
    const filePath = resolveImagePath(sessionId, filename);
    if (!filePath) {
      return c.json({ status: "error", message: "Image not found" }, 404);
    }
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml"
    };
    const contentType = mimeMap[ext ?? ""] ?? "application/octet-stream";
    const data = fs8.readFileSync(filePath);
    return new Response(data, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
  });
  return app;
}

// src/server/session-manager.ts
var SessionManager = class {
  constructor(options = {}) {
    this.sessions = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Map();
    this.pendingPermissions = /* @__PURE__ */ new Map();
    this.permissionRequestListeners = /* @__PURE__ */ new Set();
    this.lifecycleListeners = /* @__PURE__ */ new Set();
    this.configChangedListeners = /* @__PURE__ */ new Set();
    this.stateChangedListeners = /* @__PURE__ */ new Set();
    this.metadataChangedListeners = /* @__PURE__ */ new Set();
    this.maxSessions = options.maxSessions ?? getConfig().maxSessions;
    this.restoreFromDb();
  }
  /** Restore session metadata from DB (cwd, label, meta). Process state is not restored. */
  restoreFromDb() {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, meta, cwd, last_start_config, created_at FROM chat_sessions`
      ).all();
      for (const row of rows) {
        if (this.sessions.has(row.id)) continue;
        this.sessions.set(row.id, {
          id: row.id,
          process: null,
          eventBuffer: [],
          eventCounter: 0,
          label: row.label,
          cwd: row.cwd ?? process.cwd(),
          meta: row.meta ? JSON.parse(row.meta) : null,
          state: "idle",
          lastStartConfig: row.last_start_config ? JSON.parse(row.last_start_config) : null,
          ccSessionId: null,
          createdAt: new Date(row.created_at).getTime() || Date.now(),
          lastActivityAt: Date.now()
        });
      }
    } catch {
    }
  }
  /** Persist session metadata to DB. */
  persistSession(session) {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO chat_sessions (id, label, type, meta, cwd, last_start_config)
         VALUES (?, ?, 'main', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           meta = excluded.meta,
           cwd = excluded.cwd,
           last_start_config = excluded.last_start_config`
      ).run(
        session.id,
        session.label,
        session.meta ? JSON.stringify(session.meta) : null,
        session.cwd,
        session.lastStartConfig ? JSON.stringify(session.lastStartConfig) : null
      );
    } catch {
    }
  }
  /** Create a new session. Throws if session already exists or max sessions reached. */
  createSession(opts = {}) {
    const id = opts.id ?? crypto.randomUUID().slice(0, 8);
    if (this.sessions.has(id)) {
      throw new Error(`Session "${id}" already exists`);
    }
    const aliveCount = Array.from(this.sessions.values()).filter((s) => s.process?.alive).length;
    if (aliveCount >= this.maxSessions) {
      throw new Error(`Max active sessions (${this.maxSessions}) reached \u2014 ${aliveCount} alive`);
    }
    const session = {
      id,
      process: null,
      eventBuffer: [],
      eventCounter: 0,
      label: opts.label ?? id,
      cwd: opts.cwd ?? process.cwd(),
      meta: opts.meta ?? null,
      state: "idle",
      lastStartConfig: null,
      ccSessionId: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };
    this.sessions.set(id, session);
    this.persistSession(session);
    return session;
  }
  /** Update an existing session's metadata. Throws if session not found. */
  updateSession(id, opts) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session "${id}" not found`);
    if (opts.label !== void 0) session.label = opts.label;
    if (opts.meta !== void 0) session.meta = opts.meta;
    if (opts.cwd !== void 0) session.cwd = opts.cwd;
    this.persistSession(session);
    this.emitMetadataChanged(id);
    return session;
  }
  /** Get a session by ID. */
  getSession(id) {
    return this.sessions.get(id);
  }
  /** Get or create a session (used for "default" backward compat). */
  getOrCreateSession(id, opts) {
    const existing = this.sessions.get(id);
    if (existing) {
      if (opts?.cwd && opts.cwd !== existing.cwd) {
        existing.cwd = opts.cwd;
        this.persistSession(existing);
      }
      return existing;
    }
    return this.createSession({ id, ...opts });
  }
  /** Set the agent process for a session. Subscribes to events. */
  setProcess(sessionId, proc, lifecycleState) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    session.process = proc;
    session.lastActivityAt = Date.now();
    session.eventBuffer.length = 0;
    try {
      const db = getDb();
      const row = db.prepare(
        `SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?`
      ).get(sessionId);
      session.eventCounter = row.c;
    } catch {
    }
    proc.on("event", (e) => {
      if (e.type === "init") {
        if (e.data?.sessionId && !session.ccSessionId) {
          session.ccSessionId = e.data.sessionId;
          this.persistSession(session);
        }
        this.setSessionState(sessionId, session, "waiting");
      }
      if (e.type === "thinking" || e.type === "tool_use" || e.type === "assistant_delta") {
        this.setSessionState(sessionId, session, "processing");
      } else if (e.type === "complete" || e.type === "error" || e.type === "interrupted") {
        this.setSessionState(sessionId, session, "waiting");
      }
      if (e.type === "permission_needed" && e.data?.requestId && proc.respondToPermission) {
        const requestId = e.data.requestId;
        this.createPendingPermission(sessionId, {
          tool_name: e.data.toolName,
          command: e.data.command,
          path: e.data.path,
          requestId
        }).then((approved) => {
          proc.respondToPermission(requestId, approved);
        });
      }
      const persisted = this.persistEvent(sessionId, e);
      if (persisted) {
        session.eventCounter++;
        session.eventBuffer.push(e);
        if (session.eventBuffer.length > getConfig().maxEventBuffer) {
          session.eventBuffer.splice(0, session.eventBuffer.length - getConfig().maxEventBuffer);
        }
      }
      const cursor = persisted ? session.eventCounter : -1;
      const listeners = this.eventListeners.get(sessionId);
      if (listeners) {
        for (const cb of listeners) cb(cursor, e);
      }
    });
    proc.on("exit", (code) => {
      this.setSessionState(sessionId, session, "idle");
      this.emitLifecycle({ session: sessionId, state: code != null ? "exited" : "crashed", code });
    });
    proc.on("error", () => {
      this.setSessionState(sessionId, session, "idle");
      this.emitLifecycle({ session: sessionId, state: "crashed" });
    });
    this.emitLifecycle({ session: sessionId, state: lifecycleState ?? "started" });
  }
  // ── Event pub/sub (for WebSocket) ─────────────────────────────
  /** Subscribe to real-time events for a session. Returns unsubscribe function. */
  onSessionEvent(sessionId, cb) {
    let set = this.eventListeners.get(sessionId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.eventListeners.set(sessionId, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.eventListeners.delete(sessionId);
    };
  }
  /** Push a synthetic event into a session's event stream (for user message broadcast). */
  /**
   * Push an externally-persisted event into the session.
   * The caller is responsible for DB persistence — this method only updates
   * the in-memory counter/buffer and notifies listeners.
   * eventCounter increments to stay in sync with the DB row count.
   */
  pushEvent(sessionId, event) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.eventCounter++;
    session.eventBuffer.push(event);
    if (session.eventBuffer.length > getConfig().maxEventBuffer) {
      session.eventBuffer.splice(0, session.eventBuffer.length - getConfig().maxEventBuffer);
    }
    const listeners = this.eventListeners.get(sessionId);
    if (listeners) {
      for (const cb of listeners) cb(session.eventCounter, event);
    }
  }
  // ── Permission pub/sub ────────────────────────────────────────
  /** Subscribe to permission request notifications. Returns unsubscribe function. */
  onPermissionRequest(cb) {
    this.permissionRequestListeners.add(cb);
    return () => this.permissionRequestListeners.delete(cb);
  }
  // ── Session lifecycle pub/sub ──────────────────────────────────
  /** Subscribe to session lifecycle events (started/killed/exited/crashed). Returns unsubscribe function. */
  onSessionLifecycle(cb) {
    this.lifecycleListeners.add(cb);
    return () => this.lifecycleListeners.delete(cb);
  }
  emitLifecycle(event) {
    for (const cb of this.lifecycleListeners) cb(event);
  }
  // ── Config changed pub/sub ────────────────────────────────────
  /** Subscribe to session config changes. Returns unsubscribe function. */
  onConfigChanged(cb) {
    this.configChangedListeners.add(cb);
    return () => this.configChangedListeners.delete(cb);
  }
  emitConfigChanged(sessionId, config) {
    for (const cb of this.configChangedListeners) cb({ session: sessionId, config });
  }
  // ── Session metadata change pub/sub ─────────────────────────────
  onMetadataChanged(cb) {
    this.metadataChangedListeners.add(cb);
    return () => this.metadataChangedListeners.delete(cb);
  }
  emitMetadataChanged(sessionId) {
    for (const cb of this.metadataChangedListeners) cb(sessionId);
  }
  // ── Agent status change pub/sub ────────────────────────────────
  onStateChanged(cb) {
    this.stateChangedListeners.add(cb);
    return () => this.stateChangedListeners.delete(cb);
  }
  /** Update session state and push agentStatus change to subscribers. */
  updateSessionState(sessionId, newState) {
    const session = this.sessions.get(sessionId);
    if (session) this.setSessionState(sessionId, session, newState);
  }
  setSessionState(sessionId, session, newState) {
    const oldState = session.state;
    session.state = newState;
    const newStatus = !session.process?.alive ? "disconnected" : newState === "processing" ? "busy" : "idle";
    if (oldState !== newState) {
      for (const cb of this.stateChangedListeners) cb({ session: sessionId, agentStatus: newStatus, state: newState });
    }
  }
  // ── Permission management ─────────────────────────────────────
  /** Create a pending permission request. Returns a promise that resolves when approved/denied. */
  createPendingPermission(sessionId, request, opts) {
    const session = this.sessions.get(sessionId);
    if (session) this.setSessionState(sessionId, session, "permission");
    return new Promise((resolve) => {
      const createdAt = Date.now();
      this.pendingPermissions.set(sessionId, { resolve, request, createdAt });
      for (const cb of this.permissionRequestListeners) cb(sessionId, request, createdAt);
      const timeout = opts?.timeoutMs ?? getConfig().permissionTimeoutMs;
      if (timeout > 0) {
        setTimeout(() => {
          if (this.pendingPermissions.has(sessionId)) {
            this.pendingPermissions.delete(sessionId);
            resolve(false);
          }
        }, timeout);
      }
    });
  }
  /** Resolve a pending permission request. Returns false if no pending request. */
  resolvePendingPermission(sessionId, approved) {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) return false;
    pending.resolve(approved);
    this.pendingPermissions.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) this.setSessionState(sessionId, session, "processing");
    return true;
  }
  /** Get a pending permission for a specific session. */
  getPendingPermission(sessionId) {
    const p = this.pendingPermissions.get(sessionId);
    return p ? { request: p.request, createdAt: p.createdAt } : null;
  }
  /** Get all pending permissions across sessions. */
  getAllPendingPermissions() {
    return Array.from(this.pendingPermissions.entries()).map(([id, p]) => ({
      sessionId: id,
      request: p.request,
      createdAt: p.createdAt
    }));
  }
  // ── Session lifecycle ─────────────────────────────────────────
  /** Kill the agent process in a session (session stays, can be restarted). */
  /** Save the start config for a session (called by start handlers). */
  saveStartConfig(id, config) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastStartConfig = config;
    this.persistSession(session);
  }
  /** Restart session: kill → re-spawn with merged config + --resume. */
  restartSession(id, overrides, spawnFn) {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session "${id}" not found`);
    const base = session.lastStartConfig;
    if (!base) throw new Error(`Session "${id}" has no previous start config`);
    const nextProvider = overrides.provider ?? base.provider;
    const providerChanged = nextProvider !== base.provider;
    const config = {
      provider: nextProvider,
      // modelProvider is attribution metadata, not runtime-specific. Caller
      // (e.g. Loom) decides it via its model catalog and passes it in with
      // the override. Drop the base value when the override is absent on a
      // provider change, since the inherited modelProvider no longer matches.
      modelProvider: overrides.modelProvider ?? (providerChanged ? void 0 : base.modelProvider),
      model: overrides.model ?? base.model,
      permissionMode: overrides.permissionMode ?? base.permissionMode,
      configDir: providerChanged ? overrides.configDir : overrides.configDir ?? base.configDir,
      extraArgs: providerChanged ? overrides.extraArgs : overrides.extraArgs ?? base.extraArgs,
      providerOptions: providerChanged ? overrides.providerOptions : overrides.providerOptions ?? base.providerOptions
    };
    if (session.process?.alive) session.process.kill();
    const proc = spawnFn(config);
    this.setProcess(id, proc);
    session.lastStartConfig = config;
    this.persistSession(session);
    this.emitLifecycle({ session: id, state: "restarted" });
    this.emitConfigChanged(id, config);
    return { config };
  }
  /** Interrupt the current turn. Process stays alive, returns to waiting. */
  interruptSession(id) {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.interrupt();
    this.setSessionState(id, session, "waiting");
    return true;
  }
  /** Change model. Sends control message if alive, always persists to config. */
  setSessionModel(id, model) {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.setModel(model);
    if (session.lastStartConfig) {
      session.lastStartConfig.model = model;
    } else {
      session.lastStartConfig = { provider: getConfig().defaultProvider, model, permissionMode: getConfig().defaultPermissionMode };
    }
    this.persistSession(session);
    this.emitConfigChanged(id, session.lastStartConfig);
    return true;
  }
  /** Change permission mode. Sends control message if alive, always persists to config. */
  setSessionPermissionMode(id, mode) {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.setPermissionMode(mode);
    if (session.lastStartConfig) {
      session.lastStartConfig.permissionMode = mode;
    } else {
      session.lastStartConfig = { provider: getConfig().defaultProvider, model: getConfig().model, permissionMode: mode };
    }
    this.persistSession(session);
    this.emitConfigChanged(id, session.lastStartConfig);
    return true;
  }
  /** Kill the agent process in a session (session stays, can be restarted). */
  killSession(id) {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.kill();
    this.emitLifecycle({ session: id, state: "killed" });
    return true;
  }
  /** Remove a session entirely. Cannot remove "default". */
  removeSession(id) {
    if (id === "default") return false;
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.kill();
    this.eventListeners.delete(id);
    this.pendingPermissions.delete(id);
    this.sessions.delete(id);
    return true;
  }
  /** List all sessions as serializable info objects. */
  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      label: s.label,
      alive: s.process?.alive ?? false,
      state: s.state,
      agentStatus: !s.process?.alive ? "disconnected" : s.state === "processing" ? "busy" : "idle",
      cwd: s.cwd,
      meta: s.meta,
      config: s.lastStartConfig,
      ccSessionId: s.ccSessionId,
      eventCount: s.eventCounter,
      ...this.getMessageStats(s.id),
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt
    }));
  }
  /** Touch a session's lastActivityAt timestamp. */
  touch(id) {
    const session = this.sessions.get(id);
    if (session) session.lastActivityAt = Date.now();
  }
  /** Persist an agent event to chat_messages. */
  getMessageStats(sessionId) {
    try {
      const db = getDb();
      const count = db.prepare(
        `SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?`
      ).get(sessionId);
      const last = db.prepare(
        `SELECT actor, kind, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1`
      ).get(sessionId);
      return {
        messageCount: count.c,
        lastMessage: last ? { actor: last.actor, kind: last.kind, content: last.content, created_at: last.created_at } : null
      };
    } catch {
      return { messageCount: 0, lastMessage: null };
    }
  }
  /**
   * Persist an agent event to chat_messages as a canonical (actor, kind) block.
   * Returns true if a row was inserted. Streaming-only events (deltas) return
   * false so the event cursor doesn't advance for them.
   *
   * Assistant-authored blocks (text / thinking / tool_use) are stamped with
   * three-layer attribution — runtime (CLI), modelProvider (LLM API vendor),
   * and model (specific slug) — pulled from session.lastStartConfig at emit
   * time. If the user switches mid-session, subsequent rows carry the new
   * attribution. Essential for auditing, Langfuse traces, UI badges, and
   * adapters that need to know "who actually said this" when converting
   * canonical back into a provider-native format.
   *
   * Event → (actor, kind) mapping:
   *   assistant   → (assistant, text)           meta={runtime, modelProvider, model}
   *   thinking    → (assistant, thinking)       meta={runtime, modelProvider, model, signature?}
   *   tool_use    → (assistant, tool_use)       meta={runtime, modelProvider, model, id, input, name}
   *   tool_result → (system,    tool_result)    meta={toolUseId, isError}
   *   complete    → (system,    status)         meta={usage, model, ...}
   *   error       → (system,    error)          meta={status:"error"}
   */
  persistEvent(sessionId, e) {
    try {
      const db = getDb();
      const session = this.sessions.get(sessionId);
      const attr = {};
      if (session?.lastStartConfig?.provider) attr.runtime = session.lastStartConfig.provider;
      if (session?.lastStartConfig?.modelProvider) attr.modelProvider = session.lastStartConfig.modelProvider;
      if (session?.lastStartConfig?.model) attr.model = session.lastStartConfig.model;
      switch (e.type) {
        case "assistant":
          if (!e.message) return false;
          insertChatMessage(db, {
            sessionId,
            actor: "assistant",
            kind: "text",
            content: e.message,
            meta: Object.keys(attr).length > 0 ? attr : void 0
          });
          return true;
        case "thinking":
          if (!e.message) return false;
          insertChatMessage(db, {
            sessionId,
            actor: "assistant",
            kind: "thinking",
            content: e.message,
            meta: {
              ...attr,
              ...e.data?.signature ? { signature: e.data.signature } : {}
            }
          });
          return true;
        case "tool_use": {
          const toolName = e.data?.toolName ?? e.message ?? "tool";
          const toolUseId = e.data?.id ?? e.data?.toolUseId;
          if (e.data?.update && toolUseId) {
            const row = db.prepare(
              `SELECT id, meta FROM chat_messages
                WHERE session_id = ? AND actor = 'assistant' AND kind = 'tool_use'
                  AND json_extract(meta, '$.id') = ?
                ORDER BY id DESC LIMIT 1`
            ).get(sessionId, toolUseId);
            if (row) {
              const mergedMeta = {
                ...row.meta ? JSON.parse(row.meta) : {},
                ...e.data,
                id: toolUseId
              };
              updateChatMessageMeta(db, row.id, mergedMeta);
            }
            return false;
          }
          insertChatMessage(db, {
            sessionId,
            actor: "assistant",
            kind: "tool_use",
            content: toolName,
            meta: { ...attr, ...e.data ?? {}, id: toolUseId, name: toolName }
          });
          return true;
        }
        case "tool_result": {
          const toolUseId = e.data?.toolUseId ?? e.data?.id;
          insertChatMessage(db, {
            sessionId,
            actor: "system",
            kind: "tool_result",
            content: e.message ?? "",
            meta: { ...e.data ?? {}, toolUseId }
          });
          return true;
        }
        case "complete":
          insertChatMessage(db, {
            sessionId,
            actor: "system",
            kind: "status",
            content: "",
            meta: { status: "complete", ...e.data ?? {} }
          });
          return true;
        case "error":
          insertChatMessage(db, {
            sessionId,
            actor: "system",
            kind: "error",
            content: e.message ?? "Error",
            meta: { status: "error" }
          });
          return true;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }
  /** Kill all sessions. Used during shutdown. */
  killAll() {
    const pids = [];
    for (const session of this.sessions.values()) {
      if (session.process?.alive) {
        const pid = session.process.pid;
        session.process.kill();
        if (pid) pids.push(pid);
      }
    }
    if (pids.length > 0) {
      setTimeout(() => {
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
          }
        }
      }, 1e3);
    }
  }
  get size() {
    return this.sessions.size;
  }
};

// src/server/ws.ts
import { WebSocketServer } from "ws";
function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
function reply(ws, msg, data) {
  send(ws, { ...data, type: msg.type, ...msg.rid != null ? { rid: msg.rid } : {} });
}
function replyError(ws, msg, message) {
  send(ws, { type: "error", ...msg.rid != null ? { rid: msg.rid } : {}, message });
}
function attachWebSocket(server2, sessionManager2) {
  const wss = new WebSocketServer({ noServer: true });
  server2.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });
  wss.on("connection", (ws) => {
    logger.log("ws", "client connected");
    const state = { agentUnsubs: /* @__PURE__ */ new Map(), permissionUnsub: null, lifecycleUnsub: null, configChangedUnsub: null, stateChangedUnsub: null, metadataChangedUnsub: null };
    const pushSnapshot = () => send(ws, { type: "sessions.snapshot", sessions: sessionManager2.listSessions() });
    pushSnapshot();
    state.lifecycleUnsub = sessionManager2.onSessionLifecycle((event) => {
      send(ws, { type: "session.lifecycle", ...event });
      pushSnapshot();
    });
    state.configChangedUnsub = sessionManager2.onConfigChanged((event) => {
      send(ws, { type: "session.config-changed", ...event });
    });
    state.stateChangedUnsub = sessionManager2.onStateChanged((event) => {
      send(ws, { type: "session.state-changed", ...event });
      pushSnapshot();
    });
    state.metadataChangedUnsub = sessionManager2.onMetadataChanged(() => {
      pushSnapshot();
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", message: "invalid JSON" });
        return;
      }
      if (!msg.type) {
        send(ws, { type: "error", message: "type is required" });
        return;
      }
      handleMessage(ws, msg, sessionManager2, state);
    });
    ws.on("close", () => {
      logger.log("ws", "client disconnected");
      for (const unsub of state.agentUnsubs.values()) unsub();
      state.agentUnsubs.clear();
      state.permissionUnsub?.();
      state.permissionUnsub = null;
      state.lifecycleUnsub?.();
      state.lifecycleUnsub = null;
      state.configChangedUnsub?.();
      state.configChangedUnsub = null;
      state.stateChangedUnsub?.();
      state.stateChangedUnsub = null;
      state.metadataChangedUnsub?.();
      state.metadataChangedUnsub = null;
    });
  });
  return wss;
}
function handleMessage(ws, msg, sm, state) {
  switch (msg.type) {
    // ── Session CRUD ──────────────────────────────────
    case "sessions.create":
      return handleSessionsCreate(ws, msg, sm);
    case "sessions.list":
      return wsReply(ws, msg, { sessions: sm.listSessions() });
    case "sessions.update":
      return handleSessionsUpdate(ws, msg, sm);
    case "sessions.remove":
      return handleSessionsRemove(ws, msg, sm);
    // ── Agent lifecycle ───────────────────────────────
    case "agent.start":
      return handleAgentStart(ws, msg, sm);
    case "agent.send":
      return handleAgentSend(ws, msg, sm);
    case "agent.resume":
      return handleAgentResume(ws, msg, sm);
    case "agent.restart":
      return handleAgentRestart(ws, msg, sm);
    case "agent.interrupt":
      return handleAgentInterrupt(ws, msg, sm);
    case "agent.set-model":
      return handleAgentSetModel(ws, msg, sm);
    case "agent.set-permission-mode":
      return handleAgentSetPermissionMode(ws, msg, sm);
    case "agent.kill":
      return handleAgentKill(ws, msg, sm);
    case "agent.status":
      return handleAgentStatus(ws, msg, sm);
    case "agent.run-once":
      handleAgentRunOnce(ws, msg, sm);
      return;
    case "agent.completion":
      handleAgentCompletion(ws, msg);
      return;
    // ── Agent event subscription ──────────────────────
    case "agent.subscribe":
      return handleAgentSubscribe(ws, msg, sm, state);
    case "agent.unsubscribe":
      return handleAgentUnsubscribe(ws, msg, state);
    case "agent.getMessages":
      return handleAgentGetMessages(ws, msg);
    // ── Skill events ──────────────────────────────────
    // ── Permission ────────────────────────────────────
    case "permission.respond":
      return handlePermissionRespond(ws, msg, sm);
    case "permission.pending":
      return handlePermissionPending(ws, msg, sm);
    case "permission.subscribe":
      return handlePermissionSubscribe(ws, msg, sm, state);
    case "permission.unsubscribe":
      return handlePermissionUnsubscribe(ws, msg, state);
    // ── Chat sessions ─────────────────────────────────
    case "chat.sessions.list":
      return handleChatSessionsList(ws, msg);
    case "chat.sessions.create":
      return handleChatSessionsCreate(ws, msg);
    case "chat.sessions.remove":
      return handleChatSessionsRemove(ws, msg);
    // ── Chat messages ─────────────────────────────────
    case "chat.messages.list":
      return handleChatMessagesList(ws, msg);
    case "chat.messages.create":
      return handleChatMessagesCreate(ws, msg);
    case "chat.messages.clear":
      return handleChatMessagesClear(ws, msg);
    default:
      replyError(ws, msg, `Unknown message type: ${msg.type}`);
  }
}
function handleSessionsCreate(ws, msg, sm) {
  try {
    const session = sm.createSession({
      id: msg.id,
      label: msg.label,
      cwd: msg.cwd,
      meta: msg.meta
    });
    wsReply(ws, msg, { status: "created", sessionId: session.id, label: session.label, meta: session.meta });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleSessionsUpdate(ws, msg, sm) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    sm.updateSession(id, {
      label: msg.label,
      meta: msg.meta,
      cwd: msg.cwd
    });
    wsReply(ws, msg, { status: "updated", session: id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleSessionsRemove(ws, msg, sm) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  if (id === "default") return replyError(ws, msg, "Cannot remove default session");
  const removed = sm.removeSession(id);
  if (!removed) return replyError(ws, msg, "Session not found");
  wsReply(ws, msg, { status: "removed" });
}
function handleAgentStart(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const session = sm.getOrCreateSession(sessionId, {
    cwd: msg.cwd
  });
  if (session.process?.alive && !msg.force) {
    wsReply(ws, msg, { status: "already_running", provider: getConfig().defaultProvider, sessionId: session.id });
    return;
  }
  if (session.process?.alive) session.process.kill();
  const provider2 = getProvider(msg.provider ?? getConfig().defaultProvider);
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
    if (msg.prompt) {
      insertChatMessage(db, {
        sessionId,
        actor: "user",
        kind: "text",
        content: msg.prompt,
        meta: msg.meta
      });
    }
  } catch {
  }
  const cfg = getConfig();
  const providerName = msg.provider ?? cfg.defaultProvider;
  const model = msg.model ?? cfg.model;
  const permissionMode2 = msg.permissionMode;
  const configDir = msg.configDir;
  const extraArgs = msg.extraArgs;
  const providerOptions = msg.providerOptions;
  const modelProvider = msg.modelProvider;
  try {
    const proc = provider2.spawn({
      cwd: session.cwd,
      prompt: msg.prompt,
      model,
      permissionMode: permissionMode2,
      configDir,
      env: { ...msg.env, SNA_SESSION_ID: sessionId },
      history: msg.history,
      extraArgs,
      providerOptions,
      systemPrompt: msg.systemPrompt,
      appendSystemPrompt: msg.appendSystemPrompt,
      allowedTools: msg.allowedTools,
      disallowedTools: msg.disallowedTools,
      mcpServers: msg.mcpServers
    });
    sm.setProcess(sessionId, proc);
    sm.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode: permissionMode2, configDir, extraArgs, providerOptions });
    wsReply(ws, msg, { status: "started", provider: provider2.name, sessionId: session.id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentSend(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const session = sm.getSession(sessionId);
  if (!session?.process?.alive) {
    return replyError(ws, msg, `No active agent session "${sessionId}". Start first.`);
  }
  const images = msg.images;
  if (!msg.message && !images?.length) {
    return replyError(ws, msg, "message or images required");
  }
  const userText = msg.message ?? "";
  const meta = msg.meta ? { ...msg.meta } : {};
  const embeds = {};
  let contentText = userText;
  if (images?.length) {
    const saved = saveEmbeds(sessionId, images);
    const refs = saved.map(({ id, record }) => {
      embeds[id] = record;
      return formatEmbedRef(id);
    });
    contentText = userText ? `${userText}
${refs.join(" ")}` : refs.join(" ");
  }
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
    insertChatMessage(db, {
      sessionId,
      actor: "user",
      kind: "text",
      content: contentText,
      embeds: Object.keys(embeds).length > 0 ? embeds : void 0,
      meta: Object.keys(meta).length > 0 ? meta : void 0
    });
  } catch {
  }
  sm.pushEvent(sessionId, {
    type: "user_message",
    message: contentText,
    data: Object.keys(meta).length > 0 ? meta : void 0,
    timestamp: Date.now()
  });
  sm.updateSessionState(sessionId, "processing");
  sm.touch(sessionId);
  if (images?.length) {
    const content = [
      ...images.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mimeType, data: img.base64 }
      })),
      ...msg.message ? [{ type: "text", text: msg.message }] : []
    ];
    session.process.send(content);
  } else {
    session.process.send(msg.message);
  }
  wsReply(ws, msg, { status: "sent" });
}
function handleAgentResume(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const session = sm.getOrCreateSession(sessionId);
  if (session.process?.alive) {
    return replyError(ws, msg, "Session already running. Use agent.send instead.");
  }
  const history = buildCanonicalFromDb(sessionId);
  if (history.length === 0 && !msg.prompt) {
    return replyError(ws, msg, "No history in DB \u2014 nothing to resume.");
  }
  const providerName = msg.provider ?? session.lastStartConfig?.provider ?? getConfig().defaultProvider;
  const providerChanged = session.lastStartConfig && session.lastStartConfig.provider !== providerName;
  const model = msg.model ?? session.lastStartConfig?.model ?? getConfig().model;
  const permissionMode2 = msg.permissionMode ?? session.lastStartConfig?.permissionMode;
  const configDir = providerChanged ? msg.configDir : msg.configDir ?? session.lastStartConfig?.configDir;
  const extraArgs = providerChanged ? msg.extraArgs : msg.extraArgs ?? session.lastStartConfig?.extraArgs;
  const providerOptions = providerChanged ? msg.providerOptions : msg.providerOptions ?? session.lastStartConfig?.providerOptions;
  const modelProvider = msg.modelProvider ?? (providerChanged ? void 0 : session.lastStartConfig?.modelProvider);
  const provider2 = getProvider(providerName);
  try {
    const proc = provider2.spawn({
      cwd: session.cwd,
      prompt: msg.prompt,
      model,
      permissionMode: permissionMode2,
      configDir,
      env: { ...msg.env, SNA_SESSION_ID: sessionId },
      history: history.length > 0 ? history : void 0,
      extraArgs,
      providerOptions,
      systemPrompt: msg.systemPrompt,
      appendSystemPrompt: msg.appendSystemPrompt,
      allowedTools: msg.allowedTools,
      disallowedTools: msg.disallowedTools,
      mcpServers: msg.mcpServers
    });
    sm.setProcess(sessionId, proc, "resumed");
    sm.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode: permissionMode2, configDir, extraArgs, providerOptions });
    wsReply(ws, msg, {
      status: "resumed",
      provider: providerName,
      sessionId: session.id,
      historyCount: history.length
    });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentRestart(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  try {
    const session = sm.getSession(sessionId);
    const prevProvider = session?.lastStartConfig?.provider;
    const ccSessionId = session?.ccSessionId;
    const typedOpts = {
      systemPrompt: msg.systemPrompt,
      appendSystemPrompt: msg.appendSystemPrompt,
      allowedTools: msg.allowedTools,
      disallowedTools: msg.disallowedTools,
      mcpServers: msg.mcpServers
    };
    const { config } = sm.restartSession(
      sessionId,
      {
        provider: msg.provider,
        modelProvider: msg.modelProvider,
        model: msg.model,
        permissionMode: msg.permissionMode,
        configDir: msg.configDir,
        extraArgs: msg.extraArgs,
        providerOptions: msg.providerOptions
      },
      (cfg) => {
        const prov = getProvider(cfg.provider);
        const providerChanged = prevProvider && cfg.provider !== prevProvider;
        if (providerChanged) {
          const history = buildCanonicalFromDb(sessionId);
          return prov.spawn({
            cwd: sm.getSession(sessionId).cwd,
            model: cfg.model,
            permissionMode: cfg.permissionMode,
            configDir: cfg.configDir,
            env: { ...msg.env, SNA_SESSION_ID: sessionId },
            history: history.length > 0 ? history : void 0,
            extraArgs: cfg.extraArgs,
            providerOptions: cfg.providerOptions,
            ...typedOpts
          });
        }
        return prov.spawn({
          cwd: sm.getSession(sessionId).cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          configDir: cfg.configDir,
          env: { ...msg.env, SNA_SESSION_ID: sessionId },
          resumeSessionId: ccSessionId ?? void 0,
          extraArgs: cfg.extraArgs,
          providerOptions: cfg.providerOptions,
          ...typedOpts
        });
      }
    );
    wsReply(ws, msg, { status: "restarted", provider: config.provider, sessionId });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentInterrupt(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const interrupted = sm.interruptSession(sessionId);
  wsReply(ws, msg, { status: interrupted ? "interrupted" : "no_session" });
}
function handleAgentSetModel(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const model = msg.model;
  if (!model) return replyError(ws, msg, "model is required");
  const updated = sm.setSessionModel(sessionId, model);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", model });
}
function handleAgentSetPermissionMode(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const permissionMode2 = msg.permissionMode;
  if (!permissionMode2) return replyError(ws, msg, "permissionMode is required");
  const updated = sm.setSessionPermissionMode(sessionId, permissionMode2);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", permissionMode: permissionMode2 });
}
function handleAgentKill(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const killed = sm.killSession(sessionId);
  wsReply(ws, msg, { status: killed ? "killed" : "no_session" });
}
function handleAgentStatus(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const session = sm.getSession(sessionId);
  const alive = session?.process?.alive ?? false;
  let messageCount = 0;
  let lastMessage = null;
  try {
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId);
    messageCount = count?.c ?? 0;
    const last = db.prepare("SELECT actor, kind, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId);
    if (last) lastMessage = { actor: last.actor, kind: last.kind, content: last.content, created_at: last.created_at };
  } catch {
  }
  wsReply(ws, msg, {
    alive,
    agentStatus: !alive ? "disconnected" : session?.state === "processing" ? "busy" : "idle",
    sessionId: session?.process?.sessionId ?? null,
    ccSessionId: session?.ccSessionId ?? null,
    eventCount: session?.eventCounter ?? 0,
    messageCount,
    lastMessage,
    config: session?.lastStartConfig ?? null
  });
}
async function handleAgentRunOnce(ws, msg, sm) {
  if (!msg.message) return replyError(ws, msg, "message is required");
  try {
    const { result, usage } = await runOnce(sm, msg);
    wsReply(ws, msg, { result, usage });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
async function handleAgentCompletion(ws, msg) {
  if (!msg.prompt) return replyError(ws, msg, "prompt is required");
  try {
    const result = await completion(msg);
    wsReply(ws, msg, result);
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function mapChatRowToEvent(row) {
  const eventType = row.actor === "user" ? "user_message" : row.actor === "assistant" && row.kind === "text" ? "assistant" : row.actor === "assistant" && row.kind === "thinking" ? "thinking" : row.actor === "assistant" && row.kind === "tool_use" ? "tool_use" : row.actor === "system" && row.kind === "tool_result" ? "tool_result" : row.actor === "system" && row.kind === "error" ? "error" : null;
  if (!eventType) return null;
  const meta = row.meta ? JSON.parse(row.meta) : void 0;
  return {
    type: eventType,
    message: row.content,
    data: meta,
    timestamp: new Date(row.created_at).getTime()
  };
}
function countChatMessages(sessionId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?`
  ).get(sessionId);
  return row?.c ?? 0;
}
function handleAgentSubscribe(ws, msg, sm, state) {
  const sessionId = msg.session ?? "default";
  const session = sm.getOrCreateSession(sessionId);
  state.agentUnsubs.get(sessionId)?.();
  const tail = typeof msg.tail === "number" && msg.tail > 0 ? Math.floor(msg.tail) : null;
  const includeHistory = tail === null && (msg.since === 0 || msg.includeHistory === true);
  let cursor = 0;
  let oldestCursor;
  let hasMore = false;
  if (tail !== null) {
    try {
      const db = getDb();
      const total = countChatMessages(sessionId);
      const offset = Math.max(0, total - tail);
      hasMore = offset > 0;
      const rows = db.prepare(
        `SELECT actor, kind, content, meta, created_at FROM chat_messages
         WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?`
      ).all(sessionId, tail, offset);
      cursor = offset;
      if (rows.length > 0) oldestCursor = offset + 1;
      for (const row of rows) {
        cursor++;
        const event = mapChatRowToEvent(row);
        if (!event) continue;
        send(ws, {
          type: "agent.event",
          session: sessionId,
          cursor,
          isHistory: true,
          event
        });
      }
    } catch {
    }
    if (cursor < session.eventCounter) {
      const unpersisted = session.eventCounter - cursor;
      const bufferSlice = session.eventBuffer.slice(-unpersisted);
      for (const event of bufferSlice) {
        cursor++;
        send(ws, { type: "agent.event", session: sessionId, cursor, event });
      }
    }
  } else if (includeHistory) {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT actor, kind, content, meta, created_at FROM chat_messages
         WHERE session_id = ? ORDER BY id ASC`
      ).all(sessionId);
      for (const row of rows) {
        cursor++;
        const event = mapChatRowToEvent(row);
        if (!event) continue;
        send(ws, {
          type: "agent.event",
          session: sessionId,
          cursor,
          isHistory: true,
          event
        });
      }
    } catch {
    }
    if (cursor < session.eventCounter) {
      const unpersisted = session.eventCounter - cursor;
      const bufferSlice = session.eventBuffer.slice(-unpersisted);
      for (const event of bufferSlice) {
        cursor++;
        send(ws, { type: "agent.event", session: sessionId, cursor, event });
      }
    }
  } else {
    cursor = typeof msg.since === "number" && msg.since > 0 ? msg.since : session.eventCounter;
    if (cursor < session.eventCounter) {
      const startIdx = Math.max(0, session.eventBuffer.length - (session.eventCounter - cursor));
      const events = session.eventBuffer.slice(startIdx);
      for (const event of events) {
        cursor++;
        send(ws, { type: "agent.event", session: sessionId, cursor, event });
      }
    } else {
      cursor = session.eventCounter;
    }
  }
  const unsub = sm.onSessionEvent(sessionId, (eventCursor, event) => {
    if (eventCursor === -1) {
      send(ws, { type: "agent.event", session: sessionId, event });
    } else {
      send(ws, { type: "agent.event", session: sessionId, cursor: eventCursor, event });
    }
  });
  state.agentUnsubs.set(sessionId, unsub);
  reply(ws, msg, {
    cursor,
    hasMore,
    ...oldestCursor !== void 0 ? { oldestCursor } : {}
  });
}
function handleAgentGetMessages(ws, msg) {
  const sessionId = msg.session;
  if (!sessionId) return replyError(ws, msg, "session is required");
  const before = typeof msg.before === "number" && msg.before > 0 ? Math.floor(msg.before) : null;
  const requestedLimit = typeof msg.limit === "number" && msg.limit > 0 ? Math.floor(msg.limit) : 50;
  const limit = Math.min(requestedLimit, 200);
  try {
    const db = getDb();
    const total = countChatMessages(sessionId);
    let offset;
    let take;
    if (before === null) {
      offset = Math.max(0, total - limit);
      take = Math.min(limit, total);
    } else {
      const upperOrdinalExclusive = before;
      const available = upperOrdinalExclusive - 1;
      take = Math.max(0, Math.min(limit, available));
      offset = available - take;
    }
    if (take <= 0) {
      return reply(ws, msg, { events: [], hasMore: false });
    }
    const rows = db.prepare(
      `SELECT actor, kind, content, meta, created_at FROM chat_messages
       WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?`
    ).all(sessionId, take, offset);
    const events = [];
    for (let i = 0; i < rows.length; i++) {
      const cursor = offset + i + 1;
      const event = mapChatRowToEvent(rows[i]);
      if (!event) continue;
      events.push({ cursor, event });
    }
    const hasMore = offset > 0;
    const oldestCursor = rows.length > 0 ? offset + 1 : void 0;
    reply(ws, msg, {
      events,
      hasMore,
      ...oldestCursor !== void 0 ? { oldestCursor } : {}
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "DB error";
    replyError(ws, msg, message);
  }
}
function handleAgentUnsubscribe(ws, msg, state) {
  const sessionId = msg.session ?? "default";
  state.agentUnsubs.get(sessionId)?.();
  state.agentUnsubs.delete(sessionId);
  reply(ws, msg, {});
}
function handlePermissionRespond(ws, msg, sm) {
  const sessionId = msg.session ?? "default";
  const approved = msg.approved === true;
  const resolved = sm.resolvePendingPermission(sessionId, approved);
  if (!resolved) return replyError(ws, msg, "No pending permission request");
  wsReply(ws, msg, { status: approved ? "approved" : "denied" });
}
function handlePermissionPending(ws, msg, sm) {
  const sessionId = msg.session;
  if (sessionId) {
    const pending = sm.getPendingPermission(sessionId);
    wsReply(ws, msg, { pending: pending ? [{ sessionId, ...pending }] : [] });
  } else {
    wsReply(ws, msg, { pending: sm.getAllPendingPermissions() });
  }
}
function handlePermissionSubscribe(ws, msg, sm, state) {
  state.permissionUnsub?.();
  const pending = sm.getAllPendingPermissions();
  for (const p of pending) {
    send(ws, { type: "permission.request", session: p.sessionId, request: p.request, createdAt: p.createdAt, isHistory: true });
  }
  state.permissionUnsub = sm.onPermissionRequest((sessionId, request, createdAt) => {
    send(ws, { type: "permission.request", session: sessionId, request, createdAt });
  });
  reply(ws, msg, { pendingCount: pending.length });
}
function handlePermissionUnsubscribe(ws, msg, state) {
  state.permissionUnsub?.();
  state.permissionUnsub = null;
  reply(ws, msg, {});
}
function handleChatSessionsList(ws, msg) {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, label, type, meta, cwd, created_at FROM chat_sessions ORDER BY created_at DESC`
    ).all();
    const sessions = rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
    wsReply(ws, msg, { sessions });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatSessionsCreate(ws, msg) {
  const id = msg.id ?? crypto.randomUUID().slice(0, 8);
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`).run(id, msg.label ?? id, msg.chatType ?? "background", msg.meta ? JSON.stringify(msg.meta) : null);
    wsReply(ws, msg, { status: "created", id, meta: msg.meta ?? null });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatSessionsRemove(ws, msg) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  if (id === "default") return replyError(ws, msg, "Cannot delete default session");
  try {
    const db = getDb();
    db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
    wsReply(ws, msg, { status: "deleted" });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatMessagesList(ws, msg) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    const db = getDb();
    const query = msg.since != null ? db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`) : db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`);
    const messages = msg.since != null ? query.all(id, msg.since) : query.all(id);
    wsReply(ws, msg, { messages });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatMessagesCreate(ws, msg) {
  const sessionId = msg.session;
  if (!sessionId) return replyError(ws, msg, "session is required");
  const actor = msg.actor;
  const kind = msg.kind;
  if (!actor || !kind) return replyError(ws, msg, "actor and kind are required");
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, sessionId);
    const id = insertChatMessage(db, {
      sessionId,
      actor,
      kind,
      content: msg.content ?? "",
      embeds: msg.embeds,
      meta: msg.meta
    });
    wsReply(ws, msg, { status: "created", id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleChatMessagesClear(ws, msg) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    const db = getDb();
    db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
    wsReply(ws, msg, { status: "cleared" });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}

// src/server/index.ts
function createSnaApp(options = {}) {
  const sessionManager2 = options.sessionManager ?? new SessionManager();
  const app = new Hono3();
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));
  app.route("/agent", createAgentRoutes(sessionManager2));
  app.route("/chat", createChatRoutes());
  return app;
}

// src/server/standalone.ts
try {
  getDb();
} catch (err2) {
  if (err2.message?.includes("NODE_MODULE_VERSION")) {
    console.error(`
\u2717  better-sqlite3 was compiled for a different Node.js version.`);
    console.error(`   This usually happens when electron-rebuild overwrites the native binary.`);
    console.error(`   Pass nativeBinding to startSnaServer({ nativeBinding }) so the server`);
    console.error(`   loads the consumer app's electron-rebuilt copy instead.
`);
  } else {
    console.error(`
\u2717  Database initialization failed: ${err2.message}
`);
  }
  process.exit(1);
}
var { port, defaultPermissionMode: permissionMode, model: defaultModel, maxSessions } = getConfig();
var root = new Hono4();
root.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
root.onError((err2, c) => {
  logger.err("err", `${c.req.method} ${new URL(c.req.url).pathname} \u2192 ${err2.message}`);
  return c.json({ status: "error", message: err2.message, stack: err2.stack }, 500);
});
root.use("*", async (c, next) => {
  const m = c.req.method;
  const path9 = new URL(c.req.url).pathname;
  logger.log("req", `${m.padEnd(6)} ${path9}`);
  await next();
});
var sessionManager = new SessionManager({ maxSessions });
sessionManager.getOrCreateSession("default", { cwd: process.cwd() });
var provider = getProvider("claude-code");
logger.log("sna", "spawning agent...");
var agentProcess = provider.spawn({ cwd: process.cwd(), permissionMode, model: defaultModel });
sessionManager.setProcess("default", agentProcess);
root.route("/", createSnaApp({ sessionManager }));
var server = null;
var shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  logger.log("sna", "stopping all sessions...");
  sessionManager.killAll();
  if (server) {
    server.close(() => {
      logger.log("sna", "clean shutdown \u2014 see you next time");
      console.log("");
      process.exit(0);
    });
  }
  setTimeout(() => {
    logger.log("sna", "shutdown complete");
    console.log("");
    process.exit(0);
  }, 3e3).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err2) => {
  if (shuttingDown) process.exit(0);
  console.error(err2);
  process.exit(1);
});
server = serve({ fetch: root.fetch, port }, () => {
  console.log("");
  logger.log("sna", `API server ready \u2192 http://localhost:${port}`);
  logger.log("sna", `WebSocket endpoint \u2192 ws://localhost:${port}/ws`);
  console.log("");
});
attachWebSocket(server, sessionManager);
agentProcess.on("event", (e) => {
  if (e.type === "init") {
    logger.log("agent", `agent ready (session=${e.data?.sessionId ?? "?"})`);
  }
});
