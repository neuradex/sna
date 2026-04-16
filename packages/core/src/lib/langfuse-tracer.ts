/**
 * langfuse-tracer.ts — Optional Langfuse tracing for SNA sessions.
 *
 * Structure:
 *   Langfuse Session = SNA session (groups all turns)
 *   Langfuse Trace   = 1 turn (user_message → complete)
 *     input  = user message
 *     output = assistant response
 *     children: thinking (generation), tool spans, etc.
 *
 * Design principles:
 * - Lazy dynamic import — no-op if langfuse not installed
 * - When active, ALL sessions are traced (tracer active = debug mode ON)
 * - Fire-and-forget: errors logged, never thrown
 * - Logs go through onLog callback → Loom structured logs
 */

import type { AgentEvent } from "../core/providers/types.js";
import type { SessionManager, SessionLifecycleEvent } from "../server/session-manager.js";
import { setConfig } from "../config.js";
import { logger as snaLogger } from "./logger.js";

// ── Internal state ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let langfuseClient: any = null;

/** Per-turn trace state */
interface TurnTrace {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trace: any;
  input: string;
  output: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingToolSpans: Map<string, any>;
  turnIndex: number;
  /** Active LLM call generation (created by proxy, ended on assistant/complete) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llmGeneration: any | null;
}

/** Per-session state */
interface SessionState {
  sessionId: string;
  /** Langfuse sessionId (may differ from SNA sessionId if mapSessionId is set) */
  langfuseSessionId: string;
  label: string;
  currentTurn: TurnTrace | null;
  turnCounter: number;
  eventUnsub: (() => void) | null;
}

const sessions = new Map<string, SessionState>();
let lifecycleUnsub: (() => void) | null = null;
let sm: SessionManager | null = null;
let _userId: string | undefined;
let _userEmail: string | undefined;
let _baseTags: string[] = [];
let _mapSessionId: ((sessionId: string, label: string) => string) | null = null;
let _apiProxy: { port: number; close: () => void } | null = null;

/** Set the current user info for Langfuse traces. */
export function setTracerUser(userId?: string, userEmail?: string): void {
  _userId = userId;
  _userEmail = userEmail;
}

// ── Logger (routed through SDK logger for logLevel filtering) ───────────────

function log(msg: string): void {
  snaLogger.log("langfuse", msg);
}
function logError(msg: string): void {
  snaLogger.err("err", `[langfuse] ${msg}`);
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function initTracer(
  config: {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
    tags?: string[];
    /** Map SNA sessionId + label to a custom Langfuse sessionId. */
    mapSessionId?: (sessionId: string, label: string) => string;
  },
  sessionManager: SessionManager,
  /** @deprecated onLog is ignored — langfuse logs now route through SDK logger */
  _onLog?: (msg: string) => void,
): Promise<void> {
  log(`init: publicKey=${config.publicKey.slice(0, 12)}..., baseUrl=${config.baseUrl ?? "default"}`);
  _baseTags = config.tags ?? [];
  _mapSessionId = config.mapSessionId ?? null;

  try {
    const mod = await import("langfuse");
    const Langfuse = mod.Langfuse;
    langfuseClient = new Langfuse({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl ?? "https://cloud.langfuse.com",
    });
    sm = sessionManager;
    log("client created");
  } catch (err) {
    logError(`import/init failed: ${err}`);
    return;
  }

  // Start API proxy to capture system prompts
  try {
    const { startApiProxy } = await import("./api-proxy.js");
    _apiProxy = await startApiProxy({
      onRequest: (info) => {
        log(`proxy → ${info.model} stream=${info.stream} messages=${info.messageCount}`);

        // Skip title generation requests (haiku model, short system prompt)
        const sysText = typeof info.system === "string" ? info.system : "";
        const sysArr = Array.isArray(info.system) ? info.system as Array<{ text?: string }> : [];
        const fullSysText = sysText || sysArr.map((b) => b.text ?? "").join("\n");
        if (fullSysText.includes("title generator")) {
          log("skipped title generation request");
          return;
        }

        // Build OpenAI-style messages: system + user/assistant messages
        const input: Array<{ role: string; content: string }> = [];
        if (fullSysText) {
          input.push({ role: "system", content: fullSysText });
        }
        if (Array.isArray(info.messages)) {
          for (const m of info.messages as Array<{ role?: string; content?: unknown }>) {
            const role = m.role ?? "user";
            let content = "";
            if (typeof m.content === "string") {
              content = m.content;
            } else if (Array.isArray(m.content)) {
              content = (m.content as Array<{ type?: string; text?: string }>)
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("\n");
            }
            input.push({ role, content });
          }
        }

        // Find active turn and create LLM generation
        for (const [, ss] of sessions) {
          if (ss.currentTurn) {
            try {
              // End previous llm generation if still open (multi-turn within same turn)
              if (ss.currentTurn.llmGeneration) {
                ss.currentTurn.llmGeneration.end();
              }
              ss.currentTurn.llmGeneration = ss.currentTurn.trace.generation({
                name: "llm-call",
                model: info.model,
                input,
              });
              log(`llm-call generation created for turn ${ss.turnCounter} [${ss.sessionId}]`);
            } catch (err) {
              logError(`failed to create llm-call generation: ${err}`);
            }
            break;
          }
        }
      },
    });
    setConfig({ apiProxyPort: _apiProxy.port });
    log(`api proxy started on port ${_apiProxy.port}`);
  } catch (err) {
    logError(`api proxy start failed: ${err}`);
  }

  lifecycleUnsub = sessionManager.onSessionLifecycle((event) => {
    try { handleLifecycle(event); } catch (err) { logError(`lifecycle error: ${err}`); }
  });
  log("subscribed to lifecycle events");

  // Catch already-running sessions
  const allSessions = sessionManager.listSessions();
  const alive = allSessions.filter((s) => s.alive);
  log(`existing sessions: ${allSessions.length} total, ${alive.length} alive`);
  for (const info of alive) {
    subscribeSession(info.id);
  }
}

export async function shutdownTracer(): Promise<void> {
  lifecycleUnsub?.();
  lifecycleUnsub = null;

  for (const [, ss] of sessions) {
    endCurrentTurn(ss, "shutdown");
    ss.eventUnsub?.();
  }
  sessions.clear();

  // Stop API proxy
  if (_apiProxy) {
    _apiProxy.close();
    setConfig({ apiProxyPort: undefined });
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

// ── Session lifecycle ───────────────────────────────────────────────────────

function handleLifecycle(event: SessionLifecycleEvent): void {
  log(`lifecycle: ${event.session} → ${event.state}`);
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

function subscribeSession(sessionId: string): void {
  if (!langfuseClient || !sm) return;
  if (sessions.has(sessionId)) return;

  const session = sm.getSession(sessionId);
  if (!session) return;

  const label = session.label;
  const langfuseSessionId = _mapSessionId
    ? _mapSessionId(sessionId, label)
    : sessionId;

  const ss: SessionState = {
    sessionId,
    langfuseSessionId,
    label,
    currentTurn: null,
    turnCounter: 0,
    eventUnsub: null,
  };

  sessions.set(sessionId, ss);

  ss.eventUnsub = sm.onSessionEvent(sessionId, (_cursor, event) => {
    try { handleEvent(ss, event); } catch (err) { logError(`event error [${sessionId}]: ${err}`); }
  });

  log(`subscribed: ${sessionId} (label=${session.label})`);
}

function unsubscribeSession(sessionId: string, reason: string): void {
  const ss = sessions.get(sessionId);
  if (!ss) return;

  endCurrentTurn(ss, reason);
  ss.eventUnsub?.();
  sessions.delete(sessionId);
  log(`unsubscribed: ${sessionId} (${reason})`);

  try { langfuseClient?.flushAsync?.(); } catch { /* */ }
}

// ── Turn management ─────────────────────────────────────────────────────────

function startTurn(ss: SessionState, userMessage: string): void {
  // End previous turn if still open (shouldn't happen, but safety)
  if (ss.currentTurn) {
    endCurrentTurn(ss, "new_turn");
  }

  ss.turnCounter++;
  const session = sm?.getSession(ss.sessionId);

  const provider = session?.lastStartConfig?.provider ?? "unknown";
  const turnName = ss.label
    ? `${ss.label}/turn-${ss.turnCounter}`
    : `turn-${ss.turnCounter}`;
  const tags = [
    ..._baseTags,
    ...(ss.label ? [ss.label] : []),
    `provider:${provider}`,
  ];

  const trace = langfuseClient.trace({
    name: turnName,
    sessionId: ss.langfuseSessionId,
    userId: _userEmail ?? _userId,
    input: userMessage,
    metadata: {
      label: ss.label,
      provider,
      cwd: session?.cwd,
      model: session?.lastStartConfig?.model,
      turnIndex: ss.turnCounter,
    },
    tags,
  });

  ss.currentTurn = {
    trace,
    input: userMessage,
    output: "",
    pendingToolSpans: new Map(),
    turnIndex: ss.turnCounter,
    llmGeneration: null,
  };

  log(`turn ${ss.turnCounter} STARTED [${ss.sessionId}] input="${userMessage.slice(0, 60)}..."`);
}

function endCurrentTurn(ss: SessionState, reason: string): void {
  const turn = ss.currentTurn;
  if (!turn) return;

  try {
    endOrphanedSpans(turn);
    // End llm generation if still open (error/interrupted before assistant response)
    if (turn.llmGeneration) {
      turn.llmGeneration.update({ output: `(ended: ${reason})`, level: reason === "complete" ? "DEFAULT" : "WARNING" });
      turn.llmGeneration.end();
      turn.llmGeneration = null;
    }
    turn.trace.update({
      output: turn.output || "(no response)",
    });
    log(`turn ${turn.turnIndex} ENDED [${ss.sessionId}] reason=${reason}`);
  } catch (err) {
    logError(`endTurn error [${ss.sessionId}]: ${err}`);
  }

  ss.currentTurn = null;
}

// ── Event handling ──────────────────────────────────────────────────────────

function handleEvent(ss: SessionState, event: AgentEvent): void {
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
      const toolName = (event.data?.toolName as string) ?? event.message ?? "tool";
      const toolUseId = (event.data?.toolUseId ?? event.data?.id) as string | undefined;

      // Update event: refresh the existing span's input with complete data
      if (event.data?.update && toolUseId && turn.pendingToolSpans.has(toolUseId)) {
        const existing = turn.pendingToolSpans.get(toolUseId)!;
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
      const toolUseId = event.data?.toolUseId as string | undefined;
      const isError = event.data?.isError === true;
      if (toolUseId && turn.pendingToolSpans.has(toolUseId)) {
        const span = turn.pendingToolSpans.get(toolUseId)!;
        span.update({
          output: event.message ?? "",
          level: isError ? "ERROR" : "DEFAULT",
          statusMessage: isError ? (event.message ?? "tool error") : undefined,
        });
        span.end();
        turn.pendingToolSpans.delete(toolUseId);
      } else {
        turn.trace.span({
          name: "tool_result",
          input: { toolUseId },
          output: event.message ?? "",
          level: isError ? "ERROR" : "DEFAULT",
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
      // Update the llm-call generation with output and end it
      if (turn.llmGeneration) {
        turn.llmGeneration.update({ output: event.message });
        turn.llmGeneration.end();
        turn.llmGeneration = null;
      } else {
        // No proxy generation (e.g. Codex provider) — create standalone.
        // Keep it open so `complete` handler can attach usage data.
        turn.llmGeneration = turn.trace.generation({ name: "assistant", output: event.message });
      }
      break;
    }

    case "complete": {
      const turn = ss.currentTurn;
      if (!turn) break;
      // Attach usage data to open generation (Codex fallback path)
      if (turn.llmGeneration && event.data) {
        const d = event.data as Record<string, unknown>;
        turn.llmGeneration.update({
          model: d.model as string | undefined,
          usage: {
            input: d.inputTokens as number | undefined,
            output: d.outputTokens as number | undefined,
            total: ((d.inputTokens as number) ?? 0) + ((d.outputTokens as number) ?? 0),
          },
          metadata: { provider: d.provider, durationMs: d.durationMs, costUsd: d.costUsd },
        });
        turn.llmGeneration.end();
        turn.llmGeneration = null;
      }
      turn.trace.update({ metadata: event.data });
      endCurrentTurn(ss, "complete");
      try { langfuseClient?.flushAsync?.(); } catch { /* */ }
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

// ── Helpers ─────────────────────────────────────────────────────────────────

// ── Completion tracing (session-less) ────────────────────────────────────────

export interface CompletionTraceHandle {
  end(result: { text: string; model: string; usage: Record<string, number>; costUsd: number; durationMs: number }): void;
  error(err: Error): void;
}

/**
 * Create a lightweight Langfuse trace for a one-shot completion.
 * Returns null if Langfuse is not initialized — caller should skip tracing.
 */
export function traceCompletion(opts: { label: string; model?: string; input: string }): CompletionTraceHandle | null {
  if (!langfuseClient) return null;

  try {
    const trace = langfuseClient.trace({
      name: opts.label,
      userId: _userEmail ?? _userId,
      input: opts.input,
      tags: [..._baseTags, opts.label],
    });
    const generation = trace.generation({
      name: "completion",
      model: opts.model,
      input: opts.input,
    });

    return {
      end(result) {
        generation.update({
          output: result.text,
          model: result.model,
          usage: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
            total: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
          },
        });
        generation.end();
        trace.update({
          output: result.text,
          metadata: { costUsd: result.costUsd, durationMs: result.durationMs, model: result.model, usage: result.usage },
        });
        langfuseClient?.flushAsync?.().catch(() => {});
      },
      error(err) {
        generation.update({ output: `[ERROR] ${err.message}`, level: "ERROR" });
        generation.end();
        trace.update({ output: `[ERROR] ${err.message}` });
        langfuseClient?.flushAsync?.().catch(() => {});
      },
    };
  } catch (err) {
    logError(`traceCompletion failed: ${err}`);
    return null;
  }
}

function endOrphanedSpans(turn: TurnTrace): void {
  for (const [, span] of turn.pendingToolSpans) {
    try {
      span.update({
        output: "(turn ended before tool_result)",
        level: "WARNING",
        statusMessage: "orphaned",
      });
      span.end();
    } catch { /* */ }
  }
  turn.pendingToolSpans.clear();
}
