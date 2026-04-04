"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSnaContext } from "../context.js";
function useAgent(options = {}) {
  const ctx = useSnaContext();
  const {
    sessionId = ctx.sessionId,
    baseUrl = `${ctx.apiUrl}/agent`,
    provider = "claude-code",
    permissionMode
  } = options;
  const sessionParam = `session=${encodeURIComponent(sessionId)}`;
  const [connected, setConnected] = useState(false);
  const [alive, setAlive] = useState(false);
  const esRef = useRef(null);
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
        const res = await fetch(`${baseUrl}/status?${sessionParam}`);
        const data = await res.json();
        cursor = data.eventCount ?? 0;
        if (data.alive) setAlive(true);
      } catch {
      }
      function connect() {
        if (disposed) return;
        if (esRef.current) esRef.current.close();
        const es = new EventSource(`${baseUrl}/events?${sessionParam}&since=${cursor}`);
        esRef.current = es;
        es.onopen = () => setConnected(true);
        es.onmessage = (e) => {
          if (!e.data || disposed) return;
          if (e.lastEventId) cursor = parseInt(e.lastEventId, 10);
          try {
            const event = JSON.parse(e.data);
            onEventRef.current?.(event);
            if (event.type === "init") onInitRef.current?.(event);
            if (event.type === "thinking") onThinkingRef.current?.(event);
            if (event.type === "assistant") onAssistantRef.current?.(event);
            if (event.type === "tool_result") onToolResultRef.current?.(event);
            if (event.type === "complete") onCompleteRef.current?.(event);
            if (event.type === "error") onErrorRef.current?.(event);
          } catch {
          }
        };
        es.onerror = () => {
          setConnected(false);
          es.close();
          if (!disposed) setTimeout(connect, 3e3);
        };
      }
      connect();
    }
    init();
    return () => {
      disposed = true;
      esRef.current?.close();
    };
  }, [baseUrl, sessionParam]);
  const send = useCallback(async (message) => {
    console.log(`[useAgent:send] session=${sessionId}, message=${message.slice(0, 50)}`);
    setAlive(true);
    try {
      const res = await fetch(`${baseUrl}/send?${sessionParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      console.log("[useAgent:send] response:", data);
      return data;
    } catch (err) {
      console.error("[useAgent:send] FAILED:", err);
      return { status: "error", message: String(err) };
    }
  }, [baseUrl, sessionParam, sessionId]);
  const start = useCallback(async (prompt) => {
    const res = await fetch(`${baseUrl}/start?${sessionParam}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, prompt, permissionMode })
    });
    const data = await res.json();
    if (data.status === "started" || data.status === "already_running") {
      setAlive(true);
    }
    return data;
  }, [baseUrl, sessionParam, provider, permissionMode]);
  const kill = useCallback(async () => {
    setAlive(false);
    await fetch(`${baseUrl}/kill?${sessionParam}`, { method: "POST" });
  }, [baseUrl, sessionParam]);
  return { connected, alive, start, send, kill };
}
export {
  useAgent
};
