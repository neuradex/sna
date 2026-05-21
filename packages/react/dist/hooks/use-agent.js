"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { authHeaders, useSnaContext } from "../context.js";
function useAgent(options = {}) {
  const ctx = useSnaContext();
  const {
    sessionId = ctx.sessionId,
    baseUrl = `${ctx.apiUrl}/agent`,
    authToken = ctx.authToken,
    provider = "claude-code",
    permissionMode,
    reasoningLevel,
    providerOptions
  } = options;
  const sessionParam = `session=${encodeURIComponent(sessionId)}`;
  const [connected, setConnected] = useState(false);
  const [alive, setAlive] = useState(false);
  const streamAbortRef = useRef(null);
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
  useEffect(() => {
    let disposed = false;
    async function init() {
      let cursor = 0;
      try {
        const res = await fetch(`${baseUrl}/status?${sessionParam}`, {
          headers: authHeaders(authToken)
        });
        const data = await res.json();
        cursor = data.eventCount ?? 0;
        if (data.alive) setAlive(true);
      } catch {
      }
      function connect() {
        if (disposed) return;
        streamAbortRef.current?.abort();
        const ctrl = new AbortController();
        streamAbortRef.current = ctrl;
        fetch(`${baseUrl}/events?${sessionParam}&since=${cursor}`, {
          headers: authHeaders(authToken, { Accept: "text/event-stream" }),
          signal: ctrl.signal
        }).then(async (res) => {
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          setConnected(true);
          await readSse(res, {
            onId: (id) => {
              cursor = parseInt(id, 10);
            },
            onData: (data) => {
              if (!data || disposed) return;
              try {
                const event = JSON.parse(data);
                onEventRef.current?.(event);
                if (event.type === "init") onInitRef.current?.(event);
                if (event.type === "thinking") onThinkingRef.current?.(event);
                if (event.type === "assistant") onAssistantRef.current?.(event);
                if (event.type === "tool_result") onToolResultRef.current?.(event);
                if (event.type === "complete") onCompleteRef.current?.(event);
                if (event.type === "error") onErrorRef.current?.(event);
              } catch {
              }
            }
          });
        }).catch(() => {
        }).finally(() => {
          setConnected(false);
          if (!disposed && !ctrl.signal.aborted) setTimeout(connect, 3e3);
        });
      }
      connect();
    }
    init();
    return () => {
      disposed = true;
      streamAbortRef.current?.abort();
    };
  }, [baseUrl, sessionParam, authToken]);
  const send = useCallback(async (message) => {
    console.log(`[useAgent:send] session=${sessionId}, message=${message.slice(0, 50)}`);
    setAlive(true);
    try {
      const res = await fetch(`${baseUrl}/send?${sessionParam}`, {
        method: "POST",
        headers: authHeaders(authToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      console.log("[useAgent:send] response:", data);
      return data;
    } catch (err) {
      console.error("[useAgent:send] FAILED:", err);
      return { status: "error", message: String(err) };
    }
  }, [baseUrl, sessionParam, sessionId, authToken]);
  const start = useCallback(async (prompt) => {
    const res = await fetch(`${baseUrl}/start?${sessionParam}`, {
      method: "POST",
      headers: authHeaders(authToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ provider, prompt, permissionMode, reasoningLevel, providerOptions })
    });
    const data = await res.json();
    if (data.status === "started" || data.status === "already_running") {
      setAlive(true);
    }
    return data;
  }, [baseUrl, sessionParam, authToken, provider, permissionMode, reasoningLevel, providerOptions]);
  const kill = useCallback(async () => {
    setAlive(false);
    await fetch(`${baseUrl}/kill?${sessionParam}`, {
      method: "POST",
      headers: authHeaders(authToken)
    });
  }, [baseUrl, sessionParam, authToken]);
  const completion = useCallback(async (opts) => {
    const res = await fetch(`${baseUrl}/completion`, {
      method: "POST",
      headers: authHeaders(authToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        provider,
        reasoningLevel,
        ...opts
      })
    });
    return res.json();
  }, [baseUrl, authToken, provider, reasoningLevel]);
  return { connected, alive, start, send, kill, completion };
}
async function readSse(response, handlers) {
  const reader = response.body.getReader();
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
          data += `${line.slice(5).trimStart()}
`;
        }
      }
    }
    if (buffer) flush();
  } finally {
    reader.releaseLock();
  }
}
export {
  useAgent
};
