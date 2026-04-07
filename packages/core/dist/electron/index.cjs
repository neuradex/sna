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

// src/config.ts
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
function getConfig() {
  return current;
}
function setConfig(overrides) {
  current = { ...current, ...overrides };
}
var defaults, current;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    init_cjs_shims();
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
      dbPath: "data/sna.db"
    };
    current = { ...defaults, ...fromEnv() };
  }
});

// src/lib/api-proxy.ts
var api_proxy_exports = {};
__export(api_proxy_exports, {
  startApiProxy: () => startApiProxy
});
async function startApiProxy(opts = {}) {
  const targetBase = opts.targetBaseUrl ?? "https://api.anthropic.com";
  let systemPrompt = null;
  const server = import_http.default.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      });
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      try {
        const body = JSON.parse(rawBody.toString());
        if (body.system) systemPrompt = body.system;
        opts.onRequest?.({
          model: body.model ?? "unknown",
          stream: !!body.stream,
          system: body.system ?? null,
          messages: body.messages ?? null,
          messageCount: body.messages?.length ?? 0
        });
      } catch {
      }
    }
    const target = new import_url2.URL(req.url ?? "/", targetBase);
    const isHttps = target.protocol === "https:";
    const transport = isHttps ? import_https.default : import_http.default;
    const headers = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") continue;
      if (val) headers[key] = Array.isArray(val) ? val.join(", ") : val;
    }
    headers["host"] = target.host;
    const proxyReq = transport.request(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err2) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `proxy error: ${err2.message}` }));
    });
    proxyReq.end(rawBody);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        server,
        close: () => server.close(),
        get systemPrompt() {
          return systemPrompt;
        }
      });
    });
  });
}
var import_http, import_https, import_url2;
var init_api_proxy = __esm({
  "src/lib/api-proxy.ts"() {
    "use strict";
    init_cjs_shims();
    import_http = __toESM(require("http"), 1);
    import_https = __toESM(require("https"), 1);
    import_url2 = require("url");
  }
});

// src/lib/langfuse-tracer.ts
var langfuse_tracer_exports = {};
__export(langfuse_tracer_exports, {
  initTracer: () => initTracer,
  setTracerUser: () => setTracerUser,
  shutdownTracer: () => shutdownTracer
});
function setTracerUser(userId, userEmail) {
  _userId = userId;
  _userEmail = userEmail;
}
function log2(msg) {
  if (_onLog2) _onLog2(`[langfuse] ${msg}`);
  else try {
    console.log(`[langfuse] ${msg}`);
  } catch {
  }
}
function logError(msg) {
  if (_onLog2) _onLog2(`[langfuse] ERROR: ${msg}`);
  else try {
    console.error(`[langfuse] ERROR: ${msg}`);
  } catch {
  }
}
async function initTracer(config, sessionManager, onLog) {
  _onLog2 = onLog ?? null;
  log2(`init: publicKey=${config.publicKey.slice(0, 12)}..., baseUrl=${config.baseUrl ?? "default"}`);
  try {
    const mod = await import("langfuse");
    const Langfuse = mod.Langfuse;
    langfuseClient = new Langfuse({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl ?? "https://cloud.langfuse.com"
    });
    sm = sessionManager;
    log2("client created");
  } catch (err2) {
    logError(`import/init failed: ${err2}`);
    return;
  }
  try {
    const { startApiProxy: startApiProxy2 } = await Promise.resolve().then(() => (init_api_proxy(), api_proxy_exports));
    _apiProxy = await startApiProxy2({
      onRequest: (info) => {
        log2(`proxy \u2192 ${info.model} stream=${info.stream} messages=${info.messageCount}`);
        const sysText = typeof info.system === "string" ? info.system : "";
        const sysArr = Array.isArray(info.system) ? info.system : [];
        const fullSysText = sysText || sysArr.map((b) => b.text ?? "").join("\n");
        if (fullSysText.includes("title generator")) {
          log2("skipped title generation request");
          return;
        }
        const input = [];
        if (fullSysText) {
          input.push({ role: "system", content: fullSysText });
        }
        if (Array.isArray(info.messages)) {
          for (const m of info.messages) {
            const role = m.role ?? "user";
            let content = "";
            if (typeof m.content === "string") {
              content = m.content;
            } else if (Array.isArray(m.content)) {
              content = m.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
            }
            input.push({ role, content });
          }
        }
        for (const [, ss] of sessions) {
          if (ss.currentTurn) {
            try {
              if (ss.currentTurn.llmGeneration) {
                ss.currentTurn.llmGeneration.end();
              }
              ss.currentTurn.llmGeneration = ss.currentTurn.trace.generation({
                name: "llm-call",
                model: info.model,
                input
              });
              log2(`llm-call generation created for turn ${ss.turnCounter} [${ss.sessionId}]`);
            } catch (err2) {
              logError(`failed to create llm-call generation: ${err2}`);
            }
            break;
          }
        }
      }
    });
    setConfig({ apiProxyPort: _apiProxy.port });
    log2(`api proxy started on port ${_apiProxy.port}`);
  } catch (err2) {
    logError(`api proxy start failed: ${err2}`);
  }
  lifecycleUnsub = sessionManager.onSessionLifecycle((event) => {
    try {
      handleLifecycle(event);
    } catch (err2) {
      logError(`lifecycle error: ${err2}`);
    }
  });
  log2("subscribed to lifecycle events");
  const allSessions = sessionManager.listSessions();
  const alive = allSessions.filter((s) => s.alive);
  log2(`existing sessions: ${allSessions.length} total, ${alive.length} alive`);
  for (const info of alive) {
    subscribeSession(info.id);
  }
}
async function shutdownTracer() {
  lifecycleUnsub?.();
  lifecycleUnsub = null;
  for (const [, ss] of sessions) {
    endCurrentTurn(ss, "shutdown");
    ss.eventUnsub?.();
  }
  sessions.clear();
  if (_apiProxy) {
    _apiProxy.close();
    setConfig({ apiProxyPort: void 0 });
    log2("api proxy stopped");
    _apiProxy = null;
  }
  if (langfuseClient) {
    try {
      await langfuseClient.shutdownAsync();
      log2("shutdown complete");
    } catch (err2) {
      logError(`shutdown error: ${err2}`);
    }
    langfuseClient = null;
  }
  sm = null;
}
function handleLifecycle(event) {
  log2(`lifecycle: ${event.session} \u2192 ${event.state}`);
  switch (event.state) {
    case "started":
    case "resumed":
      subscribeSession(event.session);
      break;
    case "exited":
    case "crashed":
    case "killed":
      unsubscribeSession(event.session, event.state);
      break;
  }
}
function subscribeSession(sessionId) {
  if (!langfuseClient || !sm) return;
  if (sessions.has(sessionId)) return;
  const session = sm.getSession(sessionId);
  if (!session) return;
  const ss = {
    sessionId,
    label: session.label,
    currentTurn: null,
    turnCounter: 0,
    eventUnsub: null
  };
  sessions.set(sessionId, ss);
  ss.eventUnsub = sm.onSessionEvent(sessionId, (_cursor, event) => {
    try {
      handleEvent(ss, event);
    } catch (err2) {
      logError(`event error [${sessionId}]: ${err2}`);
    }
  });
  log2(`subscribed: ${sessionId} (label=${session.label})`);
}
function unsubscribeSession(sessionId, reason) {
  const ss = sessions.get(sessionId);
  if (!ss) return;
  endCurrentTurn(ss, reason);
  ss.eventUnsub?.();
  sessions.delete(sessionId);
  log2(`unsubscribed: ${sessionId} (${reason})`);
  try {
    langfuseClient?.flushAsync?.();
  } catch {
  }
}
function startTurn(ss, userMessage) {
  if (ss.currentTurn) {
    endCurrentTurn(ss, "new_turn");
  }
  ss.turnCounter++;
  const session = sm?.getSession(ss.sessionId);
  const trace = langfuseClient.trace({
    name: `turn-${ss.turnCounter}`,
    sessionId: ss.sessionId,
    userId: _userEmail ?? _userId,
    input: userMessage,
    metadata: {
      label: ss.label,
      cwd: session?.cwd,
      model: session?.lastStartConfig?.model,
      turnIndex: ss.turnCounter
    },
    tags: ["loom", "debug"]
  });
  ss.currentTurn = {
    trace,
    input: userMessage,
    output: "",
    pendingToolSpans: /* @__PURE__ */ new Map(),
    turnIndex: ss.turnCounter,
    llmGeneration: null
  };
  log2(`turn ${ss.turnCounter} STARTED [${ss.sessionId}] input="${userMessage.slice(0, 60)}..."`);
}
function endCurrentTurn(ss, reason) {
  const turn = ss.currentTurn;
  if (!turn) return;
  try {
    endOrphanedSpans(turn);
    if (turn.llmGeneration) {
      turn.llmGeneration.update({ output: `(ended: ${reason})`, level: reason === "complete" ? "DEFAULT" : "WARNING" });
      turn.llmGeneration.end();
      turn.llmGeneration = null;
    }
    turn.trace.update({
      output: turn.output || "(no response)"
    });
    log2(`turn ${turn.turnIndex} ENDED [${ss.sessionId}] reason=${reason}`);
  } catch (err2) {
    logError(`endTurn error [${ss.sessionId}]: ${err2}`);
  }
  ss.currentTurn = null;
}
function handleEvent(ss, event) {
  switch (event.type) {
    case "user_message":
      startTurn(ss, event.message ?? "");
      break;
    case "thinking": {
      const turn = ss.currentTurn;
      if (!turn || !event.message) break;
      turn.trace.generation({ name: "thinking", output: event.message }).end();
      break;
    }
    case "tool_use": {
      const turn = ss.currentTurn;
      if (!turn) break;
      const toolName = event.data?.toolName ?? event.message ?? "tool";
      const toolUseId = event.data?.toolUseId ?? event.data?.id;
      if (event.data?.update && toolUseId && turn.pendingToolSpans.has(toolUseId)) {
        const existing = turn.pendingToolSpans.get(toolUseId);
        existing.update({ input: event.data });
        break;
      }
      const span = turn.trace.span({ name: `tool:${toolName}`, input: event.data });
      if (toolUseId) {
        turn.pendingToolSpans.set(toolUseId, span);
      } else {
        span.end();
      }
      break;
    }
    case "tool_result": {
      const turn = ss.currentTurn;
      if (!turn) break;
      const toolUseId = event.data?.toolUseId;
      const isError = event.data?.isError === true;
      if (toolUseId && turn.pendingToolSpans.has(toolUseId)) {
        const span = turn.pendingToolSpans.get(toolUseId);
        span.update({
          output: event.message ?? "",
          level: isError ? "ERROR" : "DEFAULT",
          statusMessage: isError ? event.message ?? "tool error" : void 0
        });
        span.end();
        turn.pendingToolSpans.delete(toolUseId);
      } else {
        turn.trace.span({
          name: "tool_result",
          input: { toolUseId },
          output: event.message ?? "",
          level: isError ? "ERROR" : "DEFAULT"
        }).end();
      }
      break;
    }
    case "permission_needed": {
      const turn = ss.currentTurn;
      if (!turn) break;
      turn.trace.event({ name: "permission_needed", input: event.data, level: "WARNING" });
      break;
    }
    case "assistant": {
      const turn = ss.currentTurn;
      if (!turn || !event.message) break;
      turn.output = event.message;
      if (turn.llmGeneration) {
        turn.llmGeneration.update({ output: event.message });
        turn.llmGeneration.end();
        turn.llmGeneration = null;
      } else {
        turn.trace.generation({ name: "assistant", output: event.message }).end();
      }
      break;
    }
    case "complete": {
      const turn = ss.currentTurn;
      if (!turn) break;
      turn.trace.update({ metadata: event.data });
      endCurrentTurn(ss, "complete");
      try {
        langfuseClient?.flushAsync?.();
      } catch {
      }
      break;
    }
    case "error": {
      const turn = ss.currentTurn;
      if (!turn) break;
      turn.trace.event({ name: "error", input: { message: event.message }, level: "ERROR" });
      turn.output = `[ERROR] ${event.message}`;
      endCurrentTurn(ss, "error");
      break;
    }
    case "interrupted": {
      const turn = ss.currentTurn;
      if (!turn) break;
      turn.trace.event({ name: "interrupted", level: "WARNING" });
      endCurrentTurn(ss, "interrupted");
      break;
    }
  }
}
function endOrphanedSpans(turn) {
  for (const [, span] of turn.pendingToolSpans) {
    try {
      span.update({
        output: "(turn ended before tool_result)",
        level: "WARNING",
        statusMessage: "orphaned"
      });
      span.end();
    } catch {
    }
  }
  turn.pendingToolSpans.clear();
}
var langfuseClient, sessions, lifecycleUnsub, sm, _onLog2, _userId, _userEmail, _apiProxy;
var init_langfuse_tracer = __esm({
  "src/lib/langfuse-tracer.ts"() {
    "use strict";
    init_cjs_shims();
    init_config();
    langfuseClient = null;
    sessions = /* @__PURE__ */ new Map();
    lifecycleUnsub = null;
    sm = null;
    _onLog2 = null;
    _apiProxy = null;
  }
});

// src/electron/index.ts
var electron_exports = {};
__export(electron_exports, {
  cacheClaudePath: () => cacheClaudePath,
  parseCommandVOutput: () => parseCommandVOutput,
  resolveClaudeCli: () => resolveClaudeCli,
  startSnaServer: () => startSnaServer,
  startSnaServerInProcess: () => startSnaServerInProcess,
  validateClaudePath: () => validateClaudePath
});
module.exports = __toCommonJS(electron_exports);
init_cjs_shims();
var import_child_process3 = require("child_process");
var import_url3 = require("url");
var import_fs7 = __toESM(require("fs"), 1);

// src/core/providers/claude-code.ts
init_cjs_shims();
var import_child_process = require("child_process");
var import_events = require("events");
var import_fs3 = __toESM(require("fs"), 1);
var import_path3 = __toESM(require("path"), 1);
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

// src/lib/logger.ts
init_cjs_shims();
var import_fs2 = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
var LOG_PATH = process.env.SNA_LOG_PATH ?? import_path2.default.join(process.cwd(), ".dev.log");
try {
  import_fs2.default.writeFileSync(LOG_PATH, "");
} catch {
}
var _onLog = null;
function setOnLog(cb) {
  _onLog = cb;
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
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.log(`${ts()} ${resolvedTag}`, ...args);
  }
  appendFile(resolvedTag, args);
}
function err(tag, ...args) {
  const resolvedTag = tags[tag] ?? tag;
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.error(`${ts()} ${resolvedTag}`, ...args);
  }
  appendFile(resolvedTag, args);
}
var logger = { log, err, setOnLog };

// src/core/providers/claude-code.ts
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
    const proxyPort = getConfig().apiProxyPort;
    if (proxyPort) {
      cleanEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
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
init_cjs_shims();
var import_hono3 = require("hono");

// src/server/routes/events.ts
init_cjs_shims();
var import_streaming = require("hono/streaming");

// src/db/schema.ts
init_cjs_shims();
var import_node_module = require("module");
var import_fs4 = __toESM(require("fs"), 1);
var import_path4 = __toESM(require("path"), 1);
function getDbPath() {
  return process.env.SNA_DB_PATH ?? import_path4.default.join(process.cwd(), "data/sna.db");
}
var NATIVE_DIR = import_path4.default.join(process.cwd(), ".sna/native");
var _db = null;
function loadBetterSqlite3() {
  const modulesPath = process.env.SNA_MODULES_PATH;
  if (modulesPath) {
    const entry = import_path4.default.join(modulesPath, "better-sqlite3");
    if (import_fs4.default.existsSync(entry)) {
      const req2 = (0, import_node_module.createRequire)(import_path4.default.join(modulesPath, "noop.js"));
      return req2("better-sqlite3");
    }
  }
  const nativeEntry = import_path4.default.join(NATIVE_DIR, "node_modules", "better-sqlite3");
  if (import_fs4.default.existsSync(nativeEntry)) {
    const req2 = (0, import_node_module.createRequire)(import_path4.default.join(NATIVE_DIR, "noop.js"));
    return req2("better-sqlite3");
  }
  const req = (0, import_node_module.createRequire)(importMetaUrl);
  return req("better-sqlite3");
}
function getDb() {
  if (!_db) {
    const BetterSqlite3 = loadBetterSqlite3();
    const dir = import_path4.default.dirname(getDbPath());
    if (!import_fs4.default.existsSync(dir)) import_fs4.default.mkdirSync(dir, { recursive: true });
    const nativeBinding = process.env.SNA_SQLITE_NATIVE_BINDING || void 0;
    _db = nativeBinding ? new BetterSqlite3(getDbPath(), { nativeBinding }) : new BetterSqlite3(getDbPath());
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
  }
  return _db;
}
function migrateSkillEvents(db) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='skill_events'"
  ).get();
  if (row?.sql?.includes("CHECK(type IN")) {
    db.exec("DROP TABLE IF EXISTS skill_events");
  }
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
function initSchema(db) {
  migrateSkillEvents(db);
  migrateChatSessionsMeta(db);
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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      skill_name TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

    CREATE TABLE IF NOT EXISTS skill_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      skill      TEXT NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      data       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill);
    CREATE INDEX IF NOT EXISTS idx_skill_events_created ON skill_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_events_session ON skill_events(session_id);
  `);
}

// src/server/routes/events.ts
init_config();
function eventsRoute(c) {
  const sinceParam = c.req.query("since");
  let lastId = sinceParam ? parseInt(sinceParam) : -1;
  if (lastId <= 0) {
    const db = getDb();
    const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get();
    lastId = row.maxId ?? 0;
  }
  return (0, import_streaming.streamSSE)(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    const keepaliveTimer = setInterval(async () => {
      if (closed) {
        clearInterval(keepaliveTimer);
        return;
      }
      try {
        await stream.writeSSE({ data: "", event: "keepalive" });
      } catch {
        closed = true;
        clearInterval(keepaliveTimer);
      }
    }, getConfig().keepaliveIntervalMs);
    while (!closed) {
      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT id, skill, type, message, data, created_at
          FROM skill_events
          WHERE id > ?
          ORDER BY id ASC
          LIMIT 50
        `).all(lastId);
        for (const row of rows) {
          if (closed) break;
          await stream.writeSSE({ data: JSON.stringify(row) });
          lastId = row.id;
        }
      } catch {
      }
      await stream.sleep(getConfig().pollIntervalMs);
    }
    clearInterval(keepaliveTimer);
  });
}

// src/server/routes/emit.ts
init_cjs_shims();

// src/server/api-types.ts
init_cjs_shims();
function httpJson(c, _op, data, status) {
  return c.json(data, status);
}
function wsReply(ws, msg, data) {
  if (ws.readyState !== ws.OPEN) return;
  const out = { ...data, type: msg.type };
  if (msg.rid != null) out.rid = msg.rid;
  ws.send(JSON.stringify(out));
}

// src/server/routes/emit.ts
function createEmitRoute(sessionManager) {
  return async (c) => {
    const body = await c.req.json();
    const { skill, message, data } = body;
    const type = body.type ?? body.eventType;
    const session_id = c.req.query("session") ?? body.session_id ?? body.session ?? null;
    if (!skill || !type || !message) {
      return c.json({ error: "missing fields" }, 400);
    }
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO skill_events (session_id, skill, type, message, data) VALUES (?, ?, ?, ?, ?)`
    ).run(session_id, skill, type, message, data ?? null);
    const id = Number(result.lastInsertRowid);
    sessionManager.broadcastSkillEvent({
      id,
      session_id: session_id ?? null,
      skill,
      type,
      message,
      data: data ?? null,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    return httpJson(c, "emit", { id });
  };
}

// src/server/routes/run.ts
init_cjs_shims();
var import_child_process2 = require("child_process");
var import_streaming2 = require("hono/streaming");
var ROOT = process.cwd();
function createRunRoute(commands) {
  return function runRoute(c) {
    const skill = c.req.query("skill") ?? "";
    const cmd = commands[skill];
    if (!cmd) {
      return c.text(`data: unknown skill: ${skill}

data: [done]

`, 200, {
        "Content-Type": "text/event-stream"
      });
    }
    return (0, import_streaming2.streamSSE)(c, async (stream) => {
      await stream.writeSSE({ data: `$ ${cmd.slice(1).join(" ")}` });
      const child = (0, import_child_process2.spawn)(cmd[0], cmd.slice(1), {
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: "0" }
      });
      const write = (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) stream.writeSSE({ data: line });
        }
      };
      child.stdout.on("data", write);
      child.stderr.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim() && !line.startsWith(">")) stream.writeSSE({ data: line });
        }
      });
      await new Promise((resolve) => {
        child.on("close", async (code) => {
          await stream.writeSSE({ data: `[exit ${code ?? 0}]` });
          await stream.writeSSE({ data: "[done]" });
          resolve();
        });
        child.on("error", async (err2) => {
          await stream.writeSSE({ data: `Error: ${err2.message}` });
          await stream.writeSSE({ data: "[done]" });
          resolve();
        });
      });
    });
  };
}

// src/server/routes/agent.ts
init_cjs_shims();
var import_hono = require("hono");
var import_streaming3 = require("hono/streaming");

// src/core/providers/index.ts
init_cjs_shims();

// src/core/providers/codex.ts
init_cjs_shims();
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
function getProvider(name = "claude-code") {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown agent provider: ${name}`);
  return provider;
}

// src/server/history-builder.ts
init_cjs_shims();
function buildHistoryFromDb(sessionId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ? AND role IN ('user', 'assistant')
     ORDER BY id ASC`
  ).all(sessionId);
  if (rows.length === 0) return [];
  const merged = [];
  for (const row of rows) {
    const role = row.role;
    if (!row.content?.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.content += "\n\n" + row.content;
    } else {
      merged.push({ role, content: row.content });
    }
  }
  return merged;
}

// src/server/image-store.ts
init_cjs_shims();
var import_fs5 = __toESM(require("fs"), 1);
var import_path5 = __toESM(require("path"), 1);
var import_crypto = require("crypto");
var IMAGE_DIR = import_path5.default.join(process.cwd(), "data/images");
var MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg"
};
function saveImages(sessionId, images) {
  const dir = import_path5.default.join(IMAGE_DIR, sessionId);
  import_fs5.default.mkdirSync(dir, { recursive: true });
  return images.map((img) => {
    const ext = MIME_TO_EXT[img.mimeType] ?? "bin";
    const hash = (0, import_crypto.createHash)("sha256").update(img.base64).digest("hex").slice(0, 12);
    const filename = `${hash}.${ext}`;
    const filePath = import_path5.default.join(dir, filename);
    if (!import_fs5.default.existsSync(filePath)) {
      import_fs5.default.writeFileSync(filePath, Buffer.from(img.base64, "base64"));
    }
    return filename;
  });
}
function resolveImagePath(sessionId, filename) {
  if (filename.includes("..") || filename.includes("/")) return null;
  const filePath = import_path5.default.join(IMAGE_DIR, sessionId, filename);
  return import_fs5.default.existsSync(filePath) ? filePath : null;
}

// src/server/routes/agent.ts
init_config();
function getSessionId(c) {
  return c.req.query("session") ?? "default";
}
async function runOnce(sessionManager, opts) {
  const sessionId = `run-once-${crypto.randomUUID().slice(0, 8)}`;
  const timeout = opts.timeout ?? getConfig().runOnceTimeoutMs;
  const session = sessionManager.createSession({
    id: sessionId,
    label: "run-once",
    cwd: opts.cwd ?? process.cwd()
  });
  const cfg = getConfig();
  const provider = getProvider(opts.provider ?? cfg.defaultProvider);
  const extraArgs = opts.extraArgs ? [...opts.extraArgs] : [];
  if (opts.systemPrompt) extraArgs.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) extraArgs.push("--append-system-prompt", opts.appendSystemPrompt);
  const proc = provider.spawn({
    cwd: session.cwd,
    prompt: opts.message,
    model: opts.model ?? cfg.model,
    permissionMode: opts.permissionMode ?? cfg.defaultPermissionMode,
    env: { SNA_SESSION_ID: sessionId },
    extraArgs
  });
  sessionManager.setProcess(sessionId, proc);
  try {
    const result = await new Promise((resolve, reject) => {
      const texts = [];
      let usage = null;
      const timer = setTimeout(() => {
        reject(new Error(`run-once timed out after ${timeout}ms`));
      }, timeout);
      const unsub = sessionManager.onSessionEvent(sessionId, (_cursor, e) => {
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
    sessionManager.killSession(sessionId);
    sessionManager.removeSession(sessionId);
  }
}
function createAgentRoutes(sessionManager) {
  const app = new import_hono.Hono();
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const session = sessionManager.createSession({
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
    return httpJson(c, "sessions.list", { sessions: sessionManager.listSessions() });
  });
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot remove default session" }, 400);
    }
    const removed = sessionManager.removeSession(id);
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
      sessionManager.updateSession(id, {
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
      const result = await runOnce(sessionManager, body);
      return httpJson(c, "agent.run-once", result);
    } catch (e) {
      logger.err("err", `POST /run-once \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/start", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const session = sessionManager.getOrCreateSession(sessionId, {
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
    const provider = getProvider(body.provider ?? getConfig().defaultProvider);
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
      if (body.prompt) {
        db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, body.prompt, body.meta ? JSON.stringify(body.meta) : null);
      }
      const skillMatch = body.prompt?.match(/^Execute the skill:\s*(\S+)/);
      if (skillMatch) {
        db.prepare(
          `INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`
        ).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
      }
    } catch {
    }
    const providerName = body.provider ?? getConfig().defaultProvider;
    const model = body.model ?? getConfig().model;
    const permissionMode = body.permissionMode;
    const configDir = body.configDir;
    const extraArgs = body.extraArgs;
    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode,
        configDir,
        env: { SNA_SESSION_ID: sessionId },
        history: body.history,
        extraArgs
      });
      sessionManager.setProcess(sessionId, proc);
      sessionManager.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, configDir, extraArgs });
      logger.log("route", `POST /start?session=${sessionId} \u2192 started`);
      return httpJson(c, "agent.start", {
        status: "started",
        provider: provider.name,
        sessionId: session.id
      });
    } catch (e) {
      logger.err("err", `POST /start?session=${sessionId} failed: ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/send", async (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
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
    const textContent = body.message ?? "(image)";
    let meta = body.meta ? { ...body.meta } : {};
    if (body.images?.length) {
      const filenames = saveImages(sessionId, body.images);
      meta.images = filenames;
    }
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
      db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, textContent, Object.keys(meta).length > 0 ? JSON.stringify(meta) : null);
    } catch {
    }
    sessionManager.pushEvent(sessionId, {
      type: "user_message",
      message: textContent,
      data: Object.keys(meta).length > 0 ? meta : void 0,
      timestamp: Date.now()
    });
    sessionManager.updateSessionState(sessionId, "processing");
    sessionManager.touch(sessionId);
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
    const session = sessionManager.getOrCreateSession(sessionId);
    const sinceParam = c.req.query("since");
    const sinceCursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;
    return (0, import_streaming3.streamSSE)(c, async (stream) => {
      const KEEPALIVE_MS = getConfig().keepaliveIntervalMs;
      const signal = c.req.raw.signal;
      const queue = [];
      let wakeUp = null;
      const unsub = sessionManager.onSessionEvent(sessionId, (eventCursor, event) => {
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
      const ccSessionId = sessionManager.getSession(sessionId)?.ccSessionId;
      const { config } = sessionManager.restartSession(sessionId, body, (cfg) => {
        const prov = getProvider(cfg.provider);
        const resumeArgs = ccSessionId ? ["--resume", ccSessionId] : ["--resume"];
        return prov.spawn({
          cwd: sessionManager.getSession(sessionId).cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          configDir: cfg.configDir,
          env: { SNA_SESSION_ID: sessionId },
          extraArgs: [...cfg.extraArgs ?? [], ...resumeArgs]
        });
      });
      logger.log("route", `POST /restart?session=${sessionId} \u2192 restarted`);
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
    const session = sessionManager.getOrCreateSession(sessionId);
    if (session.process?.alive) {
      return c.json({ status: "error", message: "Session already running. Use agent.send instead." }, 400);
    }
    const history = buildHistoryFromDb(sessionId);
    if (history.length === 0 && !body.prompt) {
      return c.json({ status: "error", message: "No history in DB \u2014 nothing to resume." }, 400);
    }
    const providerName = body.provider ?? getConfig().defaultProvider;
    const model = body.model ?? session.lastStartConfig?.model ?? getConfig().model;
    const permissionMode = body.permissionMode ?? session.lastStartConfig?.permissionMode;
    const configDir = body.configDir ?? session.lastStartConfig?.configDir;
    const extraArgs = body.extraArgs ?? session.lastStartConfig?.extraArgs;
    const provider = getProvider(providerName);
    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode,
        configDir,
        env: { SNA_SESSION_ID: sessionId },
        history: history.length > 0 ? history : void 0,
        extraArgs
      });
      sessionManager.setProcess(sessionId, proc, "resumed");
      sessionManager.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, configDir, extraArgs });
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
    const interrupted = sessionManager.interruptSession(sessionId);
    return httpJson(c, "agent.interrupt", { status: interrupted ? "interrupted" : "no_session" });
  });
  app.post("/set-model", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    if (!body.model) return c.json({ status: "error", message: "model is required" }, 400);
    const updated = sessionManager.setSessionModel(sessionId, body.model);
    return httpJson(c, "agent.set-model", { status: updated ? "updated" : "no_session", model: body.model });
  });
  app.post("/set-permission-mode", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    if (!body.permissionMode) return c.json({ status: "error", message: "permissionMode is required" }, 400);
    const updated = sessionManager.setSessionPermissionMode(sessionId, body.permissionMode);
    return httpJson(c, "agent.set-permission-mode", { status: updated ? "updated" : "no_session", permissionMode: body.permissionMode });
  });
  app.post("/kill", async (c) => {
    const sessionId = getSessionId(c);
    const killed = sessionManager.killSession(sessionId);
    return httpJson(c, "agent.kill", { status: killed ? "killed" : "no_session" });
  });
  app.get("/status", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
    const alive = session?.process?.alive ?? false;
    let messageCount = 0;
    let lastMessage = null;
    try {
      const db = getDb();
      const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId);
      messageCount = count?.c ?? 0;
      const last = db.prepare("SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId);
      if (last) lastMessage = { role: last.role, content: last.content, created_at: last.created_at };
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
    const result = await sessionManager.createPendingPermission(sessionId, body);
    return c.json({ approved: result });
  });
  app.post("/permission-respond", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const approved = body.approved ?? false;
    const resolved = sessionManager.resolvePendingPermission(sessionId, approved);
    if (!resolved) {
      return c.json({ status: "error", message: "No pending permission request" }, 404);
    }
    logger.log("route", `POST /permission-respond?session=${sessionId} \u2192 ${approved ? "approved" : "denied"}`);
    return httpJson(c, "permission.respond", { status: approved ? "approved" : "denied" });
  });
  app.get("/permission-pending", (c) => {
    const sessionId = c.req.query("session");
    if (sessionId) {
      const pending = sessionManager.getPendingPermission(sessionId);
      return httpJson(c, "permission.pending", { pending: pending ? [{ sessionId, ...pending }] : [] });
    }
    return httpJson(c, "permission.pending", { pending: sessionManager.getAllPendingPermissions() });
  });
  return app;
}

// src/server/routes/chat.ts
init_cjs_shims();
var import_hono2 = require("hono");
var import_fs6 = __toESM(require("fs"), 1);
function createChatRoutes() {
  const app = new import_hono2.Hono();
  app.get("/sessions", (c) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, type, meta, cwd, created_at FROM chat_sessions ORDER BY created_at DESC`
      ).all();
      const sessions2 = rows.map((r) => ({
        ...r,
        meta: r.meta ? JSON.parse(r.meta) : null
      }));
      return httpJson(c, "chat.sessions.list", { sessions: sessions2 });
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
    try {
      const db = getDb();
      const query = sinceParam ? db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`) : db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`);
      const messages = sinceParam ? query.all(id, parseInt(sinceParam, 10)) : query.all(id);
      return httpJson(c, "chat.messages.list", { messages });
    } catch (e) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  });
  app.post("/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    if (!body.role) {
      return c.json({ status: "error", message: "role is required" }, 400);
    }
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, sessionId);
      const result = db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, skill_name, meta) VALUES (?, ?, ?, ?, ?)`
      ).run(
        sessionId,
        body.role,
        body.content ?? "",
        body.skill_name ?? null,
        body.meta ? JSON.stringify(body.meta) : null
      );
      return httpJson(c, "chat.messages.create", { status: "created", id: Number(result.lastInsertRowid) });
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
    const data = import_fs6.default.readFileSync(filePath);
    return new Response(data, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
  });
  return app;
}

// src/server/session-manager.ts
init_cjs_shims();
init_config();
var SessionManager = class {
  constructor(options = {}) {
    this.sessions = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Map();
    this.pendingPermissions = /* @__PURE__ */ new Map();
    this.skillEventListeners = /* @__PURE__ */ new Set();
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
  // ── Skill event pub/sub ────────────────────────────────────────
  /** Subscribe to skill events broadcast. Returns unsubscribe function. */
  onSkillEvent(cb) {
    this.skillEventListeners.add(cb);
    return () => this.skillEventListeners.delete(cb);
  }
  /** Broadcast a skill event to all subscribers (called after DB insert). */
  broadcastSkillEvent(event) {
    for (const cb of this.skillEventListeners) cb(event);
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
    const config = {
      provider: overrides.provider ?? base.provider,
      model: overrides.model ?? base.model,
      permissionMode: overrides.permissionMode ?? base.permissionMode,
      extraArgs: overrides.extraArgs ?? base.extraArgs
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
        `SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1`
      ).get(sessionId);
      return {
        messageCount: count.c,
        lastMessage: last ? { role: last.role, content: last.content, created_at: last.created_at } : null
      };
    } catch {
      return { messageCount: 0, lastMessage: null };
    }
  }
  /** Persist an agent event to chat_messages. Returns true if a row was inserted. */
  persistEvent(sessionId, e) {
    try {
      const db = getDb();
      switch (e.type) {
        case "assistant":
          if (e.message) {
            db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`).run(sessionId, e.message);
            return true;
          }
          return false;
        case "thinking":
          if (e.message) {
            db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'thinking', ?)`).run(sessionId, e.message);
            return true;
          }
          return false;
        case "tool_use": {
          const toolName = e.data?.toolName ?? e.message ?? "tool";
          if (e.data?.update) {
            db.prepare(`UPDATE chat_messages SET meta = ? WHERE session_id = ? AND role = 'tool' AND content = ? AND meta LIKE ?`).run(JSON.stringify(e.data), sessionId, toolName, `%"id":"${e.data.id}"%`);
            return false;
          }
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'tool', ?, ?)`).run(sessionId, toolName, JSON.stringify(e.data ?? {}));
          return true;
        }
        case "tool_result":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'tool_result', ?, ?)`).run(sessionId, e.message ?? "", JSON.stringify(e.data ?? {}));
          return true;
        case "complete":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'status', '', ?)`).run(sessionId, JSON.stringify({ status: "complete", ...e.data }));
          return true;
        case "error":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'error', ?, ?)`).run(sessionId, e.message ?? "Error", JSON.stringify({ status: "error" }));
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
init_cjs_shims();
var import_ws = require("ws");
init_config();
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
function attachWebSocket(server, sessionManager) {
  const wss = new import_ws.WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
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
    const state = { agentUnsubs: /* @__PURE__ */ new Map(), skillEventUnsub: null, skillPollTimer: null, permissionUnsub: null, lifecycleUnsub: null, configChangedUnsub: null, stateChangedUnsub: null, metadataChangedUnsub: null };
    const pushSnapshot = () => send(ws, { type: "sessions.snapshot", sessions: sessionManager.listSessions() });
    pushSnapshot();
    state.lifecycleUnsub = sessionManager.onSessionLifecycle((event) => {
      send(ws, { type: "session.lifecycle", ...event });
      pushSnapshot();
    });
    state.configChangedUnsub = sessionManager.onConfigChanged((event) => {
      send(ws, { type: "session.config-changed", ...event });
    });
    state.stateChangedUnsub = sessionManager.onStateChanged((event) => {
      send(ws, { type: "session.state-changed", ...event });
      pushSnapshot();
    });
    state.metadataChangedUnsub = sessionManager.onMetadataChanged(() => {
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
      handleMessage(ws, msg, sessionManager, state);
    });
    ws.on("close", () => {
      logger.log("ws", "client disconnected");
      for (const unsub of state.agentUnsubs.values()) unsub();
      state.agentUnsubs.clear();
      state.skillEventUnsub?.();
      state.skillEventUnsub = null;
      if (state.skillPollTimer) {
        clearInterval(state.skillPollTimer);
        state.skillPollTimer = null;
      }
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
function handleMessage(ws, msg, sm2, state) {
  switch (msg.type) {
    // ── Session CRUD ──────────────────────────────────
    case "sessions.create":
      return handleSessionsCreate(ws, msg, sm2);
    case "sessions.list":
      return wsReply(ws, msg, { sessions: sm2.listSessions() });
    case "sessions.update":
      return handleSessionsUpdate(ws, msg, sm2);
    case "sessions.remove":
      return handleSessionsRemove(ws, msg, sm2);
    // ── Agent lifecycle ───────────────────────────────
    case "agent.start":
      return handleAgentStart(ws, msg, sm2);
    case "agent.send":
      return handleAgentSend(ws, msg, sm2);
    case "agent.resume":
      return handleAgentResume(ws, msg, sm2);
    case "agent.restart":
      return handleAgentRestart(ws, msg, sm2);
    case "agent.interrupt":
      return handleAgentInterrupt(ws, msg, sm2);
    case "agent.set-model":
      return handleAgentSetModel(ws, msg, sm2);
    case "agent.set-permission-mode":
      return handleAgentSetPermissionMode(ws, msg, sm2);
    case "agent.kill":
      return handleAgentKill(ws, msg, sm2);
    case "agent.status":
      return handleAgentStatus(ws, msg, sm2);
    case "agent.run-once":
      handleAgentRunOnce(ws, msg, sm2);
      return;
    // ── Agent event subscription ──────────────────────
    case "agent.subscribe":
      return handleAgentSubscribe(ws, msg, sm2, state);
    case "agent.unsubscribe":
      return handleAgentUnsubscribe(ws, msg, state);
    // ── Skill events ──────────────────────────────────
    case "events.subscribe":
      return handleEventsSubscribe(ws, msg, sm2, state);
    case "events.unsubscribe":
      return handleEventsUnsubscribe(ws, msg, state);
    case "emit":
      return handleEmit(ws, msg, sm2);
    // ── Permission ────────────────────────────────────
    case "permission.respond":
      return handlePermissionRespond(ws, msg, sm2);
    case "permission.pending":
      return handlePermissionPending(ws, msg, sm2);
    case "permission.subscribe":
      return handlePermissionSubscribe(ws, msg, sm2, state);
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
function handleSessionsCreate(ws, msg, sm2) {
  try {
    const session = sm2.createSession({
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
function handleSessionsUpdate(ws, msg, sm2) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  try {
    sm2.updateSession(id, {
      label: msg.label,
      meta: msg.meta,
      cwd: msg.cwd
    });
    wsReply(ws, msg, { status: "updated", session: id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleSessionsRemove(ws, msg, sm2) {
  const id = msg.session;
  if (!id) return replyError(ws, msg, "session is required");
  if (id === "default") return replyError(ws, msg, "Cannot remove default session");
  const removed = sm2.removeSession(id);
  if (!removed) return replyError(ws, msg, "Session not found");
  wsReply(ws, msg, { status: "removed" });
}
function handleAgentStart(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const session = sm2.getOrCreateSession(sessionId, {
    cwd: msg.cwd
  });
  if (session.process?.alive && !msg.force) {
    wsReply(ws, msg, { status: "already_running", provider: getConfig().defaultProvider, sessionId: session.id });
    return;
  }
  if (session.process?.alive) session.process.kill();
  const provider = getProvider(msg.provider ?? getConfig().defaultProvider);
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
    if (msg.prompt) {
      db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, msg.prompt, msg.meta ? JSON.stringify(msg.meta) : null);
    }
    const skillMatch = msg.prompt?.match(/^Execute the skill:\s*(\S+)/);
    if (skillMatch) {
      db.prepare(`INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
    }
  } catch {
  }
  const cfg = getConfig();
  const providerName = msg.provider ?? cfg.defaultProvider;
  const model = msg.model ?? cfg.model;
  const permissionMode = msg.permissionMode;
  const configDir = msg.configDir;
  const extraArgs = msg.extraArgs;
  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt,
      model,
      permissionMode,
      configDir,
      env: { SNA_SESSION_ID: sessionId },
      history: msg.history,
      extraArgs
    });
    sm2.setProcess(sessionId, proc);
    sm2.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, configDir, extraArgs });
    wsReply(ws, msg, { status: "started", provider: provider.name, sessionId: session.id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentSend(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const session = sm2.getSession(sessionId);
  if (!session?.process?.alive) {
    return replyError(ws, msg, `No active agent session "${sessionId}". Start first.`);
  }
  const images = msg.images;
  if (!msg.message && !images?.length) {
    return replyError(ws, msg, "message or images required");
  }
  const textContent = msg.message ?? "(image)";
  let meta = msg.meta ? { ...msg.meta } : {};
  if (images?.length) {
    const filenames = saveImages(sessionId, images);
    meta.images = filenames;
  }
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, session.label ?? sessionId);
    db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'user', ?, ?)`).run(sessionId, textContent, Object.keys(meta).length > 0 ? JSON.stringify(meta) : null);
  } catch {
  }
  sm2.pushEvent(sessionId, {
    type: "user_message",
    message: textContent,
    data: Object.keys(meta).length > 0 ? meta : void 0,
    timestamp: Date.now()
  });
  sm2.updateSessionState(sessionId, "processing");
  sm2.touch(sessionId);
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
function handleAgentResume(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const session = sm2.getOrCreateSession(sessionId);
  if (session.process?.alive) {
    return replyError(ws, msg, "Session already running. Use agent.send instead.");
  }
  const history = buildHistoryFromDb(sessionId);
  if (history.length === 0 && !msg.prompt) {
    return replyError(ws, msg, "No history in DB \u2014 nothing to resume.");
  }
  const providerName = msg.provider ?? session.lastStartConfig?.provider ?? getConfig().defaultProvider;
  const model = msg.model ?? session.lastStartConfig?.model ?? getConfig().model;
  const permissionMode = msg.permissionMode ?? session.lastStartConfig?.permissionMode;
  const configDir = msg.configDir ?? session.lastStartConfig?.configDir;
  const extraArgs = msg.extraArgs ?? session.lastStartConfig?.extraArgs;
  const provider = getProvider(providerName);
  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt,
      model,
      permissionMode,
      configDir,
      env: { SNA_SESSION_ID: sessionId },
      history: history.length > 0 ? history : void 0,
      extraArgs
    });
    sm2.setProcess(sessionId, proc, "resumed");
    sm2.saveStartConfig(sessionId, { provider: providerName, model, permissionMode, configDir, extraArgs });
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
function handleAgentRestart(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  try {
    const ccSessionId = sm2.getSession(sessionId)?.ccSessionId;
    const { config } = sm2.restartSession(
      sessionId,
      {
        provider: msg.provider,
        model: msg.model,
        permissionMode: msg.permissionMode,
        configDir: msg.configDir,
        extraArgs: msg.extraArgs
      },
      (cfg) => {
        const prov = getProvider(cfg.provider);
        const resumeArgs = ccSessionId ? ["--resume", ccSessionId] : ["--resume"];
        return prov.spawn({
          cwd: sm2.getSession(sessionId).cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode,
          configDir: cfg.configDir,
          env: { SNA_SESSION_ID: sessionId },
          extraArgs: [...cfg.extraArgs ?? [], ...resumeArgs]
        });
      }
    );
    wsReply(ws, msg, { status: "restarted", provider: config.provider, sessionId });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentInterrupt(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const interrupted = sm2.interruptSession(sessionId);
  wsReply(ws, msg, { status: interrupted ? "interrupted" : "no_session" });
}
function handleAgentSetModel(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const model = msg.model;
  if (!model) return replyError(ws, msg, "model is required");
  const updated = sm2.setSessionModel(sessionId, model);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", model });
}
function handleAgentSetPermissionMode(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const permissionMode = msg.permissionMode;
  if (!permissionMode) return replyError(ws, msg, "permissionMode is required");
  const updated = sm2.setSessionPermissionMode(sessionId, permissionMode);
  wsReply(ws, msg, { status: updated ? "updated" : "no_session", permissionMode });
}
function handleAgentKill(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const killed = sm2.killSession(sessionId);
  wsReply(ws, msg, { status: killed ? "killed" : "no_session" });
}
function handleAgentStatus(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const session = sm2.getSession(sessionId);
  const alive = session?.process?.alive ?? false;
  let messageCount = 0;
  let lastMessage = null;
  try {
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId);
    messageCount = count?.c ?? 0;
    const last = db.prepare("SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId);
    if (last) lastMessage = { role: last.role, content: last.content, created_at: last.created_at };
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
async function handleAgentRunOnce(ws, msg, sm2) {
  if (!msg.message) return replyError(ws, msg, "message is required");
  try {
    const { result, usage } = await runOnce(sm2, msg);
    wsReply(ws, msg, { result, usage });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handleAgentSubscribe(ws, msg, sm2, state) {
  const sessionId = msg.session ?? "default";
  const session = sm2.getOrCreateSession(sessionId);
  state.agentUnsubs.get(sessionId)?.();
  const includeHistory = msg.since === 0 || msg.includeHistory === true;
  let cursor = 0;
  if (includeHistory) {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT role, content, meta, created_at FROM chat_messages
         WHERE session_id = ? ORDER BY id ASC`
      ).all(sessionId);
      for (const row of rows) {
        cursor++;
        const eventType = row.role === "user" ? "user_message" : row.role === "assistant" ? "assistant" : row.role === "thinking" ? "thinking" : row.role === "tool" ? "tool_use" : row.role === "tool_result" ? "tool_result" : row.role === "error" ? "error" : null;
        if (!eventType) continue;
        const meta = row.meta ? JSON.parse(row.meta) : void 0;
        send(ws, {
          type: "agent.event",
          session: sessionId,
          cursor,
          isHistory: true,
          event: {
            type: eventType,
            message: row.content,
            data: meta,
            timestamp: new Date(row.created_at).getTime()
          }
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
  const unsub = sm2.onSessionEvent(sessionId, (eventCursor, event) => {
    if (eventCursor === -1) {
      send(ws, { type: "agent.event", session: sessionId, event });
    } else {
      send(ws, { type: "agent.event", session: sessionId, cursor: eventCursor, event });
    }
  });
  state.agentUnsubs.set(sessionId, unsub);
  reply(ws, msg, { cursor });
}
function handleAgentUnsubscribe(ws, msg, state) {
  const sessionId = msg.session ?? "default";
  state.agentUnsubs.get(sessionId)?.();
  state.agentUnsubs.delete(sessionId);
  reply(ws, msg, {});
}
function handleEventsSubscribe(ws, msg, sm2, state) {
  state.skillEventUnsub?.();
  state.skillEventUnsub = null;
  if (state.skillPollTimer) {
    clearInterval(state.skillPollTimer);
    state.skillPollTimer = null;
  }
  let lastId = typeof msg.since === "number" ? msg.since : -1;
  if (lastId <= 0) {
    try {
      const db = getDb();
      const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get();
      lastId = row.maxId ?? 0;
    } catch {
      lastId = 0;
    }
  }
  state.skillEventUnsub = sm2.onSkillEvent((event) => {
    const eventId = event.id;
    if (eventId > lastId) {
      lastId = eventId;
      send(ws, { type: "skill.event", data: event });
    }
  });
  state.skillPollTimer = setInterval(() => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, session_id, skill, type, message, data, created_at
         FROM skill_events WHERE id > ? ORDER BY id ASC LIMIT 50`
      ).all(lastId);
      for (const row of rows) {
        if (row.id > lastId) {
          lastId = row.id;
          send(ws, { type: "skill.event", data: row });
        }
      }
    } catch {
    }
  }, getConfig().skillPollMs);
  reply(ws, msg, { lastId });
}
function handleEventsUnsubscribe(ws, msg, state) {
  state.skillEventUnsub?.();
  state.skillEventUnsub = null;
  if (state.skillPollTimer) {
    clearInterval(state.skillPollTimer);
    state.skillPollTimer = null;
  }
  reply(ws, msg, {});
}
function handleEmit(ws, msg, sm2) {
  const skill = msg.skill;
  const eventType = msg.eventType;
  const emitMessage = msg.message;
  const data = msg.data;
  const sessionId = msg.session;
  if (!skill || !eventType || !emitMessage) {
    return replyError(ws, msg, "skill, eventType, message are required");
  }
  try {
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO skill_events (session_id, skill, type, message, data) VALUES (?, ?, ?, ?, ?)`
    ).run(sessionId ?? null, skill, eventType, emitMessage, data ?? null);
    const id = Number(result.lastInsertRowid);
    sm2.broadcastSkillEvent({
      id,
      session_id: sessionId ?? null,
      skill,
      type: eventType,
      message: emitMessage,
      data: data ?? null,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    wsReply(ws, msg, { id });
  } catch (e) {
    replyError(ws, msg, e.message);
  }
}
function handlePermissionRespond(ws, msg, sm2) {
  const sessionId = msg.session ?? "default";
  const approved = msg.approved === true;
  const resolved = sm2.resolvePendingPermission(sessionId, approved);
  if (!resolved) return replyError(ws, msg, "No pending permission request");
  wsReply(ws, msg, { status: approved ? "approved" : "denied" });
}
function handlePermissionPending(ws, msg, sm2) {
  const sessionId = msg.session;
  if (sessionId) {
    const pending = sm2.getPendingPermission(sessionId);
    wsReply(ws, msg, { pending: pending ? [{ sessionId, ...pending }] : [] });
  } else {
    wsReply(ws, msg, { pending: sm2.getAllPendingPermissions() });
  }
}
function handlePermissionSubscribe(ws, msg, sm2, state) {
  state.permissionUnsub?.();
  const pending = sm2.getAllPendingPermissions();
  for (const p of pending) {
    send(ws, { type: "permission.request", session: p.sessionId, request: p.request, createdAt: p.createdAt, isHistory: true });
  }
  state.permissionUnsub = sm2.onPermissionRequest((sessionId, request, createdAt) => {
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
    const sessions2 = rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
    wsReply(ws, msg, { sessions: sessions2 });
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
  if (!msg.role) return replyError(ws, msg, "role is required");
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, sessionId);
    const result = db.prepare(
      `INSERT INTO chat_messages (session_id, role, content, skill_name, meta) VALUES (?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      msg.role,
      msg.content ?? "",
      msg.skill_name ?? null,
      msg.meta ? JSON.stringify(msg.meta) : null
    );
    wsReply(ws, msg, { status: "created", id: Number(result.lastInsertRowid) });
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
  const sessionManager = options.sessionManager ?? new SessionManager();
  const app = new import_hono3.Hono();
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));
  app.get("/events", eventsRoute);
  app.post("/emit", createEmitRoute(sessionManager));
  app.route("/agent", createAgentRoutes(sessionManager));
  app.route("/chat", createChatRoutes());
  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }
  return app;
}

// src/electron/index.ts
init_config();
function resolveStandaloneScript() {
  const selfPath = (0, import_url3.fileURLToPath)(importMetaUrl);
  let script = import_path6.default.resolve(import_path6.default.dirname(selfPath), "../server/standalone.js");
  if (script.includes(".asar") && !script.includes(".asar.unpacked")) {
    script = script.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }
  if (!import_fs7.default.existsSync(script)) {
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
  if (!import_fs7.default.existsSync(unpacked)) return void 0;
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
async function startSnaServerInProcess(options) {
  const port = options.port ?? 3099;
  const cwd = options.cwd ?? import_path6.default.dirname(options.dbPath);
  if (options.onLog) {
    logger.setOnLog(options.onLog);
  }
  setConfig({
    port,
    dbPath: options.dbPath,
    ...options.maxSessions != null ? { maxSessions: options.maxSessions } : {},
    ...options.permissionMode ? { defaultPermissionMode: options.permissionMode } : {},
    ...options.model ? { model: options.model } : {},
    ...options.permissionTimeoutMs != null ? { permissionTimeoutMs: options.permissionTimeoutMs } : {}
  });
  process.env.SNA_PORT = String(port);
  process.env.SNA_DB_PATH = options.dbPath;
  if (options.maxSessions != null) process.env.SNA_MAX_SESSIONS = String(options.maxSessions);
  if (options.permissionMode) process.env.SNA_PERMISSION_MODE = options.permissionMode;
  if (options.model) process.env.SNA_MODEL = options.model;
  if (options.permissionTimeoutMs != null) process.env.SNA_PERMISSION_TIMEOUT_MS = String(options.permissionTimeoutMs);
  if (options.nativeBinding) process.env.SNA_SQLITE_NATIVE_BINDING = options.nativeBinding;
  if (!process.env.SNA_MODULES_PATH) {
    try {
      const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
      process.env.SNA_MODULES_PATH = import_path6.default.resolve(bsPkg, "../..");
    } catch {
    }
  }
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
  } catch {
  }
  try {
    getDb();
  } catch (err2) {
    process.chdir(originalCwd);
    throw new Error(`SNA in-process: database init failed: ${err2.message}`);
  }
  process.chdir(originalCwd);
  const config = getConfig();
  const root = new import_hono4.Hono();
  root.use("*", (0, import_cors.cors)({ origin: "*", allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
  root.onError((err2, c) => {
    const pathname = new URL(c.req.url).pathname;
    if (options.onLog) options.onLog(`ERR ${c.req.method} ${pathname} \u2192 ${err2.message}`);
    return c.json({ status: "error", message: err2.message, stack: err2.stack }, 500);
  });
  root.use("*", async (c, next) => {
    const m = c.req.method;
    const pathname = new URL(c.req.url).pathname;
    if (options.onLog) options.onLog(`${m.padEnd(6)} ${pathname}`);
    await next();
  });
  const sessionManager = new SessionManager({ maxSessions: config.maxSessions });
  root.route("/", createSnaApp({ sessionManager }));
  const httpServer = (0, import_node_server.serve)({ fetch: root.fetch, port }, () => {
    if (options.onLog) options.onLog(`API server ready \u2192 http://localhost:${port}`);
    if (options.onLog) options.onLog(`WebSocket endpoint \u2192 ws://localhost:${port}/ws`);
  });
  attachWebSocket(httpServer, sessionManager);
  if (options.langfuse) {
    setConfig({ langfuse: options.langfuse });
    try {
      const { initTracer: initTracer2 } = await Promise.resolve().then(() => (init_langfuse_tracer(), langfuse_tracer_exports));
      await initTracer2(options.langfuse, sessionManager, options.onLog);
    } catch (err2) {
      if (options.onLog) options.onLog(`Langfuse tracer init skipped: ${err2.message}`);
    }
  }
  return {
    process: null,
    port,
    sessionManager,
    httpServer,
    async initLangfuse(config2) {
      setConfig({ langfuse: config2 });
      try {
        const { initTracer: initTracer2 } = await Promise.resolve().then(() => (init_langfuse_tracer(), langfuse_tracer_exports));
        await initTracer2(config2, sessionManager, options.onLog);
      } catch (err2) {
        if (options.onLog) options.onLog(`Langfuse tracer init skipped: ${err2.message}`);
      }
    },
    async setTracerUser(userId, userEmail) {
      try {
        const { setTracerUser: _setUser } = await Promise.resolve().then(() => (init_langfuse_tracer(), langfuse_tracer_exports));
        _setUser(userId, userEmail);
      } catch {
      }
    },
    async stop() {
      try {
        const { shutdownTracer: shutdownTracer2 } = await Promise.resolve().then(() => (init_langfuse_tracer(), langfuse_tracer_exports));
        await shutdownTracer2();
      } catch {
      }
      sessionManager.killAll();
      logger.setOnLog(null);
      await new Promise((resolve) => {
        httpServer.close(() => resolve());
        setTimeout(() => resolve(), 3e3).unref();
      });
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cacheClaudePath,
  parseCommandVOutput,
  resolveClaudeCli,
  startSnaServer,
  startSnaServerInProcess,
  validateClaudePath
});
