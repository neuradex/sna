"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AgentEvent } from "@sna-sdk/core";
import { authHeaders, useSnaContext } from "../context.js";

export type { AgentEvent };

interface UseAgentOptions {
  /** Session ID. Defaults to "default". */
  sessionId?: string;
  /** Override base URL for agent API. Defaults to SnaContext apiUrl + "/agent" */
  baseUrl?: string;
  /** Override bearer token. Defaults to SnaContext authToken. */
  authToken?: string;
  /** Provider name. Defaults to "claude-code" */
  provider?: string;
  /** Permission mode for the agent */
  permissionMode?: string;
  /**
   * Reasoning effort 0..5 (lightest → heaviest), passed to `start()` and
   * `completion()` so the underlying provider sets `--effort` (Claude) or
   * `model_reasoning_effort` (Codex) accordingly. Omit to inherit the
   * provider's own default.
   */
  reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;
  /**
   * Provider-specific options passed through to the selected runtime.
   * Codex-only knobs include `serviceTier` ("priority" / "flex" / "batch" —
   * the `/fast` slash-command equivalent).
   */
  providerOptions?: Record<string, unknown>;

  onEvent?: (e: AgentEvent) => void;
  onThinking?: (e: AgentEvent) => void;
  onAssistant?: (e: AgentEvent) => void;
  onToolResult?: (e: AgentEvent) => void;
  onComplete?: (e: AgentEvent) => void;
  onError?: (e: AgentEvent) => void;
  onInit?: (e: AgentEvent) => void;
}

/**
 * useAgent — subscribe to an agent session's event stream and send messages.
 *
 * Always connects to the SSE stream on mount.
 * Use `send()` to send messages (spawns `claude -p --resume` per message).
 */
export function useAgent(options: UseAgentOptions = {}) {
  const ctx = useSnaContext();
  const {
    sessionId = ctx.sessionId,
    baseUrl = `${ctx.apiUrl}/agent`,
    authToken = ctx.authToken,
    provider = "claude-code",
    permissionMode,
    reasoningLevel,
    providerOptions,
  } = options;

  const sessionParam = `session=${encodeURIComponent(sessionId)}`;

  const [connected, setConnected] = useState(false);
  const [alive, setAlive] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);

  const onEventRef = useRef(options.onEvent);
  const onThinkingRef = useRef(options.onThinking);
  const onAssistantRef = useRef(options.onAssistant);
  const onToolResultRef = useRef(options.onToolResult);
  const onCompleteRef = useRef(options.onComplete);
  const onErrorRef = useRef(options.onError);
  const onInitRef = useRef(options.onInit);
  onEventRef.current = options.onEvent;
  onThinkingRef.current = options.onThinking;
  onAssistantRef.current = options.onAssistant;
  onToolResultRef.current = options.onToolResult;
  onCompleteRef.current = options.onComplete;
  onErrorRef.current = options.onError;
  onInitRef.current = options.onInit;

  // Connect SSE on mount — start from CURRENT event count (skip past events)
  useEffect(() => {
    let disposed = false;

    async function init() {
      // Get current event count so we only receive NEW events
      let cursor = 0;
      try {
        const res = await fetch(`${baseUrl}/status?${sessionParam}`, {
          headers: authHeaders(authToken),
        });
        const data = await res.json();
        cursor = data.eventCount ?? 0;
        if (data.alive) setAlive(true);
      } catch { /* server not ready yet */ }

      function connect() {
        if (disposed) return;
        streamAbortRef.current?.abort();

        const ctrl = new AbortController();
        streamAbortRef.current = ctrl;

        fetch(`${baseUrl}/events?${sessionParam}&since=${cursor}`, {
          headers: authHeaders(authToken, { Accept: "text/event-stream" }),
          signal: ctrl.signal,
        })
          .then(async (res) => {
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            setConnected(true);
            await readSse(res, {
              onId: (id) => { cursor = parseInt(id, 10); },
              onData: (data) => {
                if (!data || disposed) return;
                try {
                  const event: AgentEvent = JSON.parse(data);
                  onEventRef.current?.(event);

                  if (event.type === "init") onInitRef.current?.(event);
                  if (event.type === "thinking") onThinkingRef.current?.(event);
                  if (event.type === "assistant") onAssistantRef.current?.(event);
                  if (event.type === "tool_result") onToolResultRef.current?.(event);
                  if (event.type === "complete") onCompleteRef.current?.(event);
                  if (event.type === "error") onErrorRef.current?.(event);
                } catch { /* malformed */ }
              },
            });
          })
          .catch(() => { /* reconnect below */ })
          .finally(() => {
            setConnected(false);
            if (!disposed && !ctrl.signal.aborted) setTimeout(connect, 3000);
          });
      }

      connect();
    }

    init();

    return () => {
      disposed = true;
      streamAbortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, sessionParam, authToken]);

  // Send message to agent
  const send = useCallback(async (message: string) => {
    console.log(`[useAgent:send] session=${sessionId}, message=${message.slice(0, 50)}`);
    setAlive(true);
    try {
      const res = await fetch(`${baseUrl}/send?${sessionParam}`, {
        method: "POST",
        headers: authHeaders(authToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      console.log("[useAgent:send] response:", data);
      return data;
    } catch (err) {
      console.error("[useAgent:send] FAILED:", err);
      return { status: "error", message: String(err) };
    }
  }, [baseUrl, sessionParam, sessionId, authToken]);

  // Start agent session (if not already running)
  const start = useCallback(async (prompt?: string) => {
    const res = await fetch(`${baseUrl}/start?${sessionParam}`, {
      method: "POST",
      headers: authHeaders(authToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ provider, prompt, permissionMode, reasoningLevel, providerOptions }),
    });
    const data = await res.json();
    if (data.status === "started" || data.status === "already_running") {
      setAlive(true);
    }
    return data;
  }, [baseUrl, sessionParam, authToken, provider, permissionMode, reasoningLevel, providerOptions]);

  // Kill agent
  const kill = useCallback(async () => {
    setAlive(false);
    await fetch(`${baseUrl}/kill?${sessionParam}`, {
      method: "POST",
      headers: authHeaders(authToken),
    });
  }, [baseUrl, sessionParam, authToken]);

  // One-shot completion
  const completion = useCallback(async (opts: {
    prompt: string;
    model?: string;
    systemPrompt?: string;
    /** Reasoning effort 0..5. Falls back to the hook-level reasoningLevel. */
    reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;
    /** Provider-specific options. Codex: `serviceTier` for `/fast` lane. */
    providerOptions?: Record<string, unknown>;
  }) => {
    const res = await fetch(`${baseUrl}/completion`, {
      method: "POST",
      headers: authHeaders(authToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        provider,
        reasoningLevel,
        ...opts,
      }),
    });
    return res.json();
  }, [baseUrl, authToken, provider, reasoningLevel]);

  return { connected, alive, start, send, kill, completion };
}

async function readSse(
  response: Response,
  handlers: { onId: (id: string) => void; onData: (data: string) => void },
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventId = "";
  let data = "";

  const flush = () => {
    if (eventId) handlers.onId(eventId);
    if (data) handlers.onData(data.replace(/\n$/, ""));
    eventId = "";
    data = "";
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          flush();
        } else if (line.startsWith("id:")) {
          eventId = line.slice(3).trim();
        } else if (line.startsWith("data:")) {
          data += `${line.slice(5).trimStart()}\n`;
        }
      }
    }
    if (buffer) flush();
  } finally {
    reader.releaseLock();
  }
}
