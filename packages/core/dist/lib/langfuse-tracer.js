import { setConfig } from "../config.js";
import { logger as snaLogger } from "./logger.js";
let langfuseClient = null;
const sessions = /* @__PURE__ */ new Map();
let lifecycleUnsub = null;
let sm = null;
let _userId;
let _userEmail;
let _baseTags = [];
let _mapSessionId = null;
let _apiProxy = null;
function setTracerUser(userId, userEmail) {
  _userId = userId;
  _userEmail = userEmail;
}
function log(msg) {
  snaLogger.log("langfuse", msg);
}
function logError(msg) {
  snaLogger.err("err", `[langfuse] ${msg}`);
}
async function initTracer(config, sessionManager, _onLog) {
  log(`init: publicKey=${config.publicKey.slice(0, 12)}..., baseUrl=${config.baseUrl ?? "default"}`);
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
    log("client created");
  } catch (err) {
    logError(`import/init failed: ${err}`);
    return;
  }
  try {
    const { startApiProxy } = await import("./api-proxy.js");
    _apiProxy = await startApiProxy({
      onRequest: (info) => {
        log(`proxy \u2192 ${info.model} stream=${info.stream} messages=${info.messageCount}`);
        const sysText = typeof info.system === "string" ? info.system : "";
        const sysArr = Array.isArray(info.system) ? info.system : [];
        const fullSysText = sysText || sysArr.map((b) => b.text ?? "").join("\n");
        if (fullSysText.includes("title generator")) {
          log("skipped title generation request");
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
              log(`llm-call generation created for turn ${ss.turnCounter} [${ss.sessionId}]`);
            } catch (err) {
              logError(`failed to create llm-call generation: ${err}`);
            }
            break;
          }
        }
      }
    });
    setConfig({ apiProxyPort: _apiProxy.port });
    log(`api proxy started on port ${_apiProxy.port}`);
  } catch (err) {
    logError(`api proxy start failed: ${err}`);
  }
  lifecycleUnsub = sessionManager.onSessionLifecycle((event) => {
    try {
      handleLifecycle(event);
    } catch (err) {
      logError(`lifecycle error: ${err}`);
    }
  });
  log("subscribed to lifecycle events");
  const allSessions = sessionManager.listSessions();
  const alive = allSessions.filter((s) => s.alive);
  log(`existing sessions: ${allSessions.length} total, ${alive.length} alive`);
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
    log("api proxy stopped");
    _apiProxy = null;
  }
  if (langfuseClient) {
    try {
      await langfuseClient.shutdownAsync();
      log("shutdown complete");
    } catch (err) {
      logError(`shutdown error: ${err}`);
    }
    langfuseClient = null;
  }
  sm = null;
}
function handleLifecycle(event) {
  log(`lifecycle: ${event.session} \u2192 ${event.state}`);
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
    } catch (err) {
      logError(`event error [${sessionId}]: ${err}`);
    }
  });
  log(`subscribed: ${sessionId} (label=${session.label})`);
}
function unsubscribeSession(sessionId, reason) {
  const ss = sessions.get(sessionId);
  if (!ss) return;
  endCurrentTurn(ss, reason);
  ss.eventUnsub?.();
  sessions.delete(sessionId);
  log(`unsubscribed: ${sessionId} (${reason})`);
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
  const turnName = ss.label ? `${ss.label}/turn-${ss.turnCounter}` : `turn-${ss.turnCounter}`;
  const tags = [
    ..._baseTags,
    ...ss.label ? [ss.label] : []
  ];
  const trace = langfuseClient.trace({
    name: turnName,
    sessionId: ss.langfuseSessionId,
    userId: _userEmail ?? _userId,
    input: userMessage,
    metadata: {
      label: ss.label,
      cwd: session?.cwd,
      model: session?.lastStartConfig?.model,
      turnIndex: ss.turnCounter
    },
    tags
  });
  ss.currentTurn = {
    trace,
    input: userMessage,
    output: "",
    pendingToolSpans: /* @__PURE__ */ new Map(),
    turnIndex: ss.turnCounter,
    llmGeneration: null
  };
  log(`turn ${ss.turnCounter} STARTED [${ss.sessionId}] input="${userMessage.slice(0, 60)}..."`);
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
    log(`turn ${turn.turnIndex} ENDED [${ss.sessionId}] reason=${reason}`);
  } catch (err) {
    logError(`endTurn error [${ss.sessionId}]: ${err}`);
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
export {
  initTracer,
  setTracerUser,
  shutdownTracer
};
