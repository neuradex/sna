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
  if (process.env.SNA_DATA_DIR) env.dataDir = process.env.SNA_DATA_DIR;
  if (process.env.SNA_PERMISSION_TIMEOUT_MS) env.permissionTimeoutMs = parseInt(process.env.SNA_PERMISSION_TIMEOUT_MS, 10);
  return env;
}
function getConfig() {
  return current;
}
function setConfig(overrides) {
  current = { ...current, ...overrides };
}
var import_path, defaults, current;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    init_cjs_shims();
    import_path = __toESM(require("path"), 1);
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
      dataDir: import_path.default.join(process.cwd(), "data")
    };
    current = { ...defaults, ...fromEnv() };
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
var import_fs2, import_path3, LOG_PATH, _onLog, _logLevel, TAG_LEVELS, LEVEL_ORDER, tags, logger;
var init_logger = __esm({
  "src/lib/logger.ts"() {
    "use strict";
    init_cjs_shims();
    import_fs2 = __toESM(require("fs"), 1);
    import_path3 = __toESM(require("path"), 1);
    LOG_PATH = process.env.SNA_LOG_PATH ?? import_path3.default.join(process.cwd(), ".dev.log");
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
    const target = new import_url3.URL(req.url ?? "/", targetBase);
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
var import_http, import_https, import_url3;
var init_api_proxy = __esm({
  "src/lib/api-proxy.ts"() {
    "use strict";
    init_cjs_shims();
    import_http = __toESM(require("http"), 1);
    import_https = __toESM(require("https"), 1);
    import_url3 = require("url");
  }
});

// src/lib/langfuse-tracer.ts
var langfuse_tracer_exports = {};
__export(langfuse_tracer_exports, {
  initTracer: () => initTracer,
  setTracerUser: () => setTracerUser,
  shutdownTracer: () => shutdownTracer,
  traceCompletion: () => traceCompletion
});
function setTracerUser(userId, userEmail) {
  _userId = userId;
  _userEmail = userEmail;
}
function log2(msg) {
  logger.log("langfuse", msg);
}
function logError(msg) {
  logger.err("err", `[langfuse] ${msg}`);
}
async function initTracer(config, sessionManager, _onLog2) {
  log2(`init: publicKey=${config.publicKey.slice(0, 12)}..., baseUrl=${config.baseUrl ?? "default"}`);
  _baseTags = config.tags ?? [];
  _mapSessionId = config.mapSessionId ?? null;
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
  const label = session.label;
  const langfuseSessionId = _mapSessionId ? _mapSessionId(sessionId, label) : sessionId;
  const ss = {
    sessionId,
    langfuseSessionId,
    label,
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
  const runtime = session?.lastStartConfig?.provider ?? "unknown";
  const modelProvider = session?.lastStartConfig?.modelProvider ?? "unknown";
  const model = session?.lastStartConfig?.model ?? "unknown";
  const turnName = ss.label ? `${ss.label}/turn-${ss.turnCounter}` : `turn-${ss.turnCounter}`;
  const tags2 = [
    ..._baseTags,
    ...ss.label ? [ss.label] : [],
    `runtime:${runtime}`,
    `modelProvider:${modelProvider}`,
    `model:${model}`
  ];
  const trace = langfuseClient.trace({
    name: turnName,
    sessionId: ss.langfuseSessionId,
    userId: _userEmail ?? _userId,
    input: userMessage,
    metadata: {
      label: ss.label,
      runtime,
      modelProvider,
      model,
      cwd: session?.cwd,
      turnIndex: ss.turnCounter
    },
    tags: tags2
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
        turn.llmGeneration = turn.trace.generation({ name: "assistant", output: event.message });
      }
      break;
    }
    case "complete": {
      const turn = ss.currentTurn;
      if (!turn) break;
      if (turn.llmGeneration && event.data) {
        const d = event.data;
        const session = sm?.getSession(ss.sessionId);
        turn.llmGeneration.update({
          model: d.model ?? session?.lastStartConfig?.model,
          usage: {
            input: d.inputTokens,
            output: d.outputTokens,
            total: (d.inputTokens ?? 0) + (d.outputTokens ?? 0)
          },
          metadata: {
            runtime: d.provider ?? session?.lastStartConfig?.provider,
            modelProvider: session?.lastStartConfig?.modelProvider,
            durationMs: d.durationMs,
            costUsd: d.costUsd
          }
        });
        turn.llmGeneration.end();
        turn.llmGeneration = null;
      }
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
var langfuseClient, sessions, lifecycleUnsub, sm, _userId, _userEmail, _baseTags, _mapSessionId, _apiProxy;
var init_langfuse_tracer = __esm({
  "src/lib/langfuse-tracer.ts"() {
    "use strict";
    init_cjs_shims();
    init_config();
    init_logger();
    langfuseClient = null;
    sessions = /* @__PURE__ */ new Map();
    lifecycleUnsub = null;
    sm = null;
    _baseTags = [];
    _mapSessionId = null;
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
var import_child_process4 = require("child_process");
var import_url4 = require("url");
var import_fs9 = __toESM(require("fs"), 1);

// src/core/providers/claude-code.ts
init_cjs_shims();
var import_child_process = require("child_process");
var import_events = require("events");
var import_fs3 = __toESM(require("fs"), 1);
var import_path4 = __toESM(require("path"), 1);
var import_url = require("url");

// src/history/claude-code.ts
init_cjs_shims();
var import_fs = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
init_config();

// src/history/embed-refs.ts
init_cjs_shims();
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
  const fullPath = import_path2.default.isAbsolute(record.path) ? record.path : import_path2.default.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    return import_fs.default.readFileSync(fullPath).toString("base64");
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
    const dir = import_path2.default.join(opts.cwd, ".sna", "history");
    import_fs.default.mkdirSync(dir, { recursive: true });
    const syntheticSessionId = crypto.randomUUID();
    const filePath = import_path2.default.join(dir, `${syntheticSessionId}.jsonl`);
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
    import_fs.default.writeFileSync(filePath, lines.join("\n") + "\n");
    return { filePath, extraArgs: ["--resume", filePath] };
  } catch {
    return null;
  }
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
var import_path9 = __toESM(require("path"), 1);
var import_hono4 = require("hono");
var import_cors = require("hono/cors");
var import_node_server = require("@hono/node-server");

// src/server/index.ts
init_cjs_shims();
var import_hono3 = require("hono");

// src/server/routes/agent.ts
init_cjs_shims();
var import_hono = require("hono");
var import_streaming = require("hono/streaming");

// src/core/providers/index.ts
init_cjs_shims();

// src/core/providers/codex.ts
init_cjs_shims();
var import_child_process2 = require("child_process");
var import_events2 = require("events");
var import_fs5 = __toESM(require("fs"), 1);
var import_path6 = __toESM(require("path"), 1);
var import_url2 = require("url");

// src/history/codex.ts
init_cjs_shims();
var import_fs4 = __toESM(require("fs"), 1);
var import_path5 = __toESM(require("path"), 1);
init_config();
function loadEmbedAsDataUrl(sessionId, record) {
  const fullPath = import_path5.default.isAbsolute(record.path) ? record.path : import_path5.default.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    const buf = import_fs4.default.readFileSync(fullPath);
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
    if (!import_fs5.default.existsSync(dir)) import_fs5.default.mkdirSync(dir, { recursive: true });
    import_fs5.default.writeFileSync(import_path6.default.join(dir, "codex-path"), codexPath);
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
    const cached = import_fs5.default.readFileSync(cacheFile, "utf8").trim();
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
    this.emitter = new import_events2.EventEmitter();
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
    const codexHome = options.configDir ?? import_path6.default.join(options.cwd, ".sna", "codex-home");
    if (!import_fs5.default.existsSync(codexHome)) {
      import_fs5.default.mkdirSync(codexHome, { recursive: true });
    }
    const realCodexHome = `${process.env.HOME}/.codex`;
    for (const f of ["auth.json", "installation_id"]) {
      const src = import_path6.default.join(realCodexHome, f);
      const dst = import_path6.default.join(codexHome, f);
      if (import_fs5.default.existsSync(src) && !import_fs5.default.existsSync(dst)) {
        import_fs5.default.copyFileSync(src, dst);
      }
    }
    const configTomlPath = import_path6.default.join(codexHome, "config.toml");
    if (!import_fs5.default.existsSync(configTomlPath)) {
      const realConfig = import_path6.default.join(realCodexHome, "config.toml");
      if (import_fs5.default.existsSync(realConfig)) {
        import_fs5.default.copyFileSync(realConfig, configTomlPath);
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
      import_fs5.default.appendFileSync(configTomlPath, "\n" + tomlLines.join("\n"));
      logger.log("agent", `codex: ${Object.keys(options.mcpServers).length} MCP servers injected`);
    }
    let pkgRoot = import_path6.default.dirname((0, import_url2.fileURLToPath)(importMetaUrl));
    while (!import_fs5.default.existsSync(import_path6.default.join(pkgRoot, "package.json"))) {
      const parent = import_path6.default.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const preToolUseHooks = [];
    if (options.permissionMode !== "bypassPermissions") {
      const hookScript = import_path6.default.join(pkgRoot, "dist", "scripts", "hook.js");
      const sessionId = options.env?.SNA_SESSION_ID ?? "default";
      preToolUseHooks.push({
        type: "command",
        command: `node "${hookScript}" --session=${sessionId}`,
        timeout: 300
      });
      logger.log("agent", `codex: permission hook \u2192 ${hookScript} --session=${sessionId}`);
    }
    if (options.allowedTools?.length || options.disallowedTools?.length) {
      const filterScript = import_path6.default.join(pkgRoot, "dist", "scripts", "tool-filter.js");
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
      import_fs5.default.writeFileSync(import_path6.default.join(codexHome, "hooks.json"), JSON.stringify(hooksJson));
      const existingConfig = import_fs5.default.readFileSync(configTomlPath, "utf8");
      if (!existingConfig.includes("codex_hooks")) {
        import_fs5.default.appendFileSync(configTomlPath, "\n[features]\ncodex_hooks = true\n");
      }
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
function getProvider(name = "claude-code") {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown agent provider: ${name}`);
  return provider;
}

// src/server/routes/agent.ts
init_logger();

// src/db/schema.ts
init_cjs_shims();
var import_node_module = require("module");
var import_fs6 = __toESM(require("fs"), 1);
var import_path7 = __toESM(require("path"), 1);
function getDbPath() {
  return process.env.SNA_DB_PATH ?? import_path7.default.join(process.cwd(), "data/sna.db");
}
var NATIVE_DIR = import_path7.default.join(process.cwd(), ".sna/native");
var _db = null;
function loadBetterSqlite3() {
  const modulesPath = process.env.SNA_MODULES_PATH;
  if (modulesPath) {
    const entry = import_path7.default.join(modulesPath, "better-sqlite3");
    if (import_fs6.default.existsSync(entry)) {
      const req2 = (0, import_node_module.createRequire)(import_path7.default.join(modulesPath, "noop.js"));
      return req2("better-sqlite3");
    }
  }
  const nativeEntry = import_path7.default.join(NATIVE_DIR, "node_modules", "better-sqlite3");
  if (import_fs6.default.existsSync(nativeEntry)) {
    const req2 = (0, import_node_module.createRequire)(import_path7.default.join(NATIVE_DIR, "noop.js"));
    return req2("better-sqlite3");
  }
  const req = (0, import_node_module.createRequire)(importMetaUrl);
  return req("better-sqlite3");
}
function getDb() {
  if (!_db) {
    const BetterSqlite3 = loadBetterSqlite3();
    const dir = import_path7.default.dirname(getDbPath());
    if (!import_fs6.default.existsSync(dir)) import_fs6.default.mkdirSync(dir, { recursive: true });
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
init_cjs_shims();
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

// src/server/image-store.ts
init_cjs_shims();
var import_fs7 = __toESM(require("fs"), 1);
var import_path8 = __toESM(require("path"), 1);
var import_crypto = require("crypto");
init_config();
function getImageDir() {
  return import_path8.default.join(getConfig().dataDir, "images");
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
  const dir = import_path8.default.join(getImageDir(), sessionId);
  import_fs7.default.mkdirSync(dir, { recursive: true });
  return attachments.map((att) => {
    const ext = MIME_TO_EXT[att.mimeType] ?? "bin";
    const id = (0, import_crypto.createHash)("sha256").update(att.base64).digest("hex").slice(0, 12);
    const filename = `${id}.${ext}`;
    const filePath = import_path8.default.join(dir, filename);
    if (!import_fs7.default.existsSync(filePath)) {
      import_fs7.default.writeFileSync(filePath, Buffer.from(att.base64, "base64"));
    }
    return {
      id,
      record: { mime_type: att.mimeType, path: filename }
    };
  });
}
function resolveImagePath(sessionId, filename) {
  if (filename.includes("..") || filename.includes("/")) return null;
  const filePath = import_path8.default.join(getImageDir(), sessionId, filename);
  return import_fs7.default.existsSync(filePath) ? filePath : null;
}

// src/db/chat-messages.ts
init_cjs_shims();
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

// src/server/routes/agent.ts
init_config();

// src/core/completion.ts
init_cjs_shims();
var import_child_process3 = require("child_process");
init_logger();
init_config();
init_langfuse_tracer();
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
    const proc = (0, import_child_process3.spawn)(claudePath, args, {
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
    const proc = (0, import_child_process3.spawn)(codexPath, args, {
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
    env: { ...opts.env, SNA_SESSION_ID: sessionId },
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
      sessionManager.setProcess(sessionId, proc);
      sessionManager.saveStartConfig(sessionId, { provider: providerName, modelProvider: body.modelProvider, model, permissionMode, configDir, extraArgs, providerOptions: body.providerOptions });
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
    sessionManager.pushEvent(sessionId, {
      type: "user_message",
      message: contentText,
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
    return (0, import_streaming.streamSSE)(c, async (stream) => {
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
      const session = sessionManager.getSession(sessionId);
      const prevProvider = session?.lastStartConfig?.provider;
      const ccSessionId = session?.ccSessionId;
      const { config } = sessionManager.restartSession(sessionId, body, (cfg) => {
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
            cwd: sessionManager.getSession(sessionId).cwd,
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
          cwd: sessionManager.getSession(sessionId).cwd,
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
    const session = sessionManager.getOrCreateSession(sessionId);
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
    const permissionMode = body.permissionMode ?? session.lastStartConfig?.permissionMode;
    const configDir = providerChanged ? body.configDir : body.configDir ?? session.lastStartConfig?.configDir;
    const extraArgs = providerChanged ? body.extraArgs : body.extraArgs ?? session.lastStartConfig?.extraArgs;
    const providerOptions = providerChanged ? body.providerOptions : body.providerOptions ?? session.lastStartConfig?.providerOptions;
    const modelProvider = body.modelProvider ?? (providerChanged ? void 0 : session.lastStartConfig?.modelProvider);
    const provider = getProvider(providerName);
    try {
      const proc = provider.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode,
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
      sessionManager.setProcess(sessionId, proc, "resumed");
      sessionManager.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode, configDir, extraArgs, providerOptions });
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
var import_fs8 = __toESM(require("fs"), 1);
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
    const data = import_fs8.default.readFileSync(filePath);
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
init_cjs_shims();
var import_ws = require("ws");
init_logger();
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
    const state = { agentUnsubs: /* @__PURE__ */ new Map(), permissionUnsub: null, lifecycleUnsub: null, configChangedUnsub: null, stateChangedUnsub: null, metadataChangedUnsub: null };
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
    case "agent.completion":
      handleAgentCompletion(ws, msg);
      return;
    // ── Agent event subscription ──────────────────────
    case "agent.subscribe":
      return handleAgentSubscribe(ws, msg, sm2, state);
    case "agent.unsubscribe":
      return handleAgentUnsubscribe(ws, msg, state);
    // ── Skill events ──────────────────────────────────
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
  const permissionMode = msg.permissionMode;
  const configDir = msg.configDir;
  const extraArgs = msg.extraArgs;
  const providerOptions = msg.providerOptions;
  const modelProvider = msg.modelProvider;
  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt,
      model,
      permissionMode,
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
    sm2.setProcess(sessionId, proc);
    sm2.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode, configDir, extraArgs, providerOptions });
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
  sm2.pushEvent(sessionId, {
    type: "user_message",
    message: contentText,
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
  const history = buildCanonicalFromDb(sessionId);
  if (history.length === 0 && !msg.prompt) {
    return replyError(ws, msg, "No history in DB \u2014 nothing to resume.");
  }
  const providerName = msg.provider ?? session.lastStartConfig?.provider ?? getConfig().defaultProvider;
  const providerChanged = session.lastStartConfig && session.lastStartConfig.provider !== providerName;
  const model = msg.model ?? session.lastStartConfig?.model ?? getConfig().model;
  const permissionMode = msg.permissionMode ?? session.lastStartConfig?.permissionMode;
  const configDir = providerChanged ? msg.configDir : msg.configDir ?? session.lastStartConfig?.configDir;
  const extraArgs = providerChanged ? msg.extraArgs : msg.extraArgs ?? session.lastStartConfig?.extraArgs;
  const providerOptions = providerChanged ? msg.providerOptions : msg.providerOptions ?? session.lastStartConfig?.providerOptions;
  const modelProvider = msg.modelProvider ?? (providerChanged ? void 0 : session.lastStartConfig?.modelProvider);
  const provider = getProvider(providerName);
  try {
    const proc = provider.spawn({
      cwd: session.cwd,
      prompt: msg.prompt,
      model,
      permissionMode,
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
    sm2.setProcess(sessionId, proc, "resumed");
    sm2.saveStartConfig(sessionId, { provider: providerName, modelProvider, model, permissionMode, configDir, extraArgs, providerOptions });
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
    const session = sm2.getSession(sessionId);
    const prevProvider = session?.lastStartConfig?.provider;
    const ccSessionId = session?.ccSessionId;
    const typedOpts = {
      systemPrompt: msg.systemPrompt,
      appendSystemPrompt: msg.appendSystemPrompt,
      allowedTools: msg.allowedTools,
      disallowedTools: msg.disallowedTools,
      mcpServers: msg.mcpServers
    };
    const { config } = sm2.restartSession(
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
            cwd: sm2.getSession(sessionId).cwd,
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
          cwd: sm2.getSession(sessionId).cwd,
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
async function handleAgentRunOnce(ws, msg, sm2) {
  if (!msg.message) return replyError(ws, msg, "message is required");
  try {
    const { result, usage } = await runOnce(sm2, msg);
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
        `SELECT actor, kind, content, meta, created_at FROM chat_messages
         WHERE session_id = ? ORDER BY id ASC`
      ).all(sessionId);
      for (const row of rows) {
        cursor++;
        const eventType = row.actor === "user" ? "user_message" : row.actor === "assistant" && row.kind === "text" ? "assistant" : row.actor === "assistant" && row.kind === "thinking" ? "thinking" : row.actor === "assistant" && row.kind === "tool_use" ? "tool_use" : row.actor === "system" && row.kind === "tool_result" ? "tool_result" : row.actor === "system" && row.kind === "error" ? "error" : null;
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
  const sessionManager = options.sessionManager ?? new SessionManager();
  const app = new import_hono3.Hono();
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));
  app.route("/agent", createAgentRoutes(sessionManager));
  app.route("/chat", createChatRoutes());
  return app;
}

// src/electron/index.ts
init_config();
init_logger();
function resolveStandaloneScript() {
  const selfPath = (0, import_url4.fileURLToPath)(importMetaUrl);
  let script = import_path9.default.resolve(import_path9.default.dirname(selfPath), "../server/standalone.js");
  if (script.includes(".asar") && !script.includes(".asar.unpacked")) {
    script = script.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }
  if (!import_fs9.default.existsSync(script)) {
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
  const unpacked = import_path9.default.join(resourcesPath, "app.asar.unpacked", "node_modules");
  if (!import_fs9.default.existsSync(unpacked)) return void 0;
  const existing = process.env.NODE_PATH;
  return existing ? `${unpacked}${import_path9.default.delimiter}${existing}` : unpacked;
}
async function startSnaServer(options) {
  const port = options.port ?? 3099;
  const cwd = options.cwd ?? import_path9.default.dirname(options.dbPath);
  const readyTimeout = options.readyTimeout ?? 15e3;
  const { onLog } = options;
  const standaloneScript = resolveStandaloneScript();
  const nodePath = buildNodePath();
  let consumerModules;
  try {
    const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
    consumerModules = import_path9.default.resolve(bsPkg, "../..");
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
  const proc = (0, import_child_process4.fork)(standaloneScript, [], {
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
  const cwd = options.cwd ?? import_path9.default.dirname(options.dbPath);
  if (options.onLog) {
    logger.setOnLog(options.onLog);
  }
  logger.setLogLevel(options.logLevel ?? "info");
  setConfig({
    port,
    dbPath: options.dbPath,
    ...options.dataDir ? { dataDir: options.dataDir } : {},
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
  if (options.dataDir) process.env.SNA_DATA_DIR = options.dataDir;
  if (options.nativeBinding) process.env.SNA_SQLITE_NATIVE_BINDING = options.nativeBinding;
  if (!process.env.SNA_MODULES_PATH) {
    try {
      const bsPkg = require.resolve("better-sqlite3/package.json", { paths: [process.cwd()] });
      process.env.SNA_MODULES_PATH = import_path9.default.resolve(bsPkg, "../..");
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
    logger.err("err", `${c.req.method} ${pathname} \u2192 ${err2.message}`);
    return c.json({ status: "error", message: err2.message, stack: err2.stack }, 500);
  });
  root.use("*", async (c, next) => {
    const m = c.req.method;
    const pathname = new URL(c.req.url).pathname;
    logger.log("req", `${m.padEnd(6)} ${pathname}`);
    await next();
  });
  const sessionManager = new SessionManager({ maxSessions: config.maxSessions });
  root.route("/", createSnaApp({ sessionManager }));
  const httpServer = (0, import_node_server.serve)({ fetch: root.fetch, port }, () => {
    logger.log("sna", `API server ready \u2192 http://localhost:${port}`);
    logger.log("sna", `WebSocket endpoint \u2192 ws://localhost:${port}/ws`);
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
      logger.setLogLevel("info");
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
