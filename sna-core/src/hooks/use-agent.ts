"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSnaContext } from "../core/sna-context.js";

export interface AgentEvent {
  type: string;
  message?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

interface UseAgentOptions {
  /** Override base URL for agent API. Defaults to SnaContext apiUrl + "/agent" */
  baseUrl?: string;
  /** Provider name. Defaults to "claude-code" */
  provider?: string;
  /** Permission mode for the agent */
  permissionMode?: string;

  onEvent?: (e: AgentEvent) => void;
  onAssistant?: (e: AgentEvent) => void;
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
  const { apiUrl } = useSnaContext();
  const {
    baseUrl = `${apiUrl}/agent`,
    provider = "claude-code",
    permissionMode = "acceptEdits",
  } = options;

  const [connected, setConnected] = useState(false);
  const [alive, setAlive] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const onEventRef = useRef(options.onEvent);
  const onAssistantRef = useRef(options.onAssistant);
  const onCompleteRef = useRef(options.onComplete);
  const onErrorRef = useRef(options.onError);
  const onInitRef = useRef(options.onInit);
  onEventRef.current = options.onEvent;
  onAssistantRef.current = options.onAssistant;
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
        const res = await fetch(`${baseUrl}/status`);
        const data = await res.json();
        cursor = data.eventCount ?? 0;
        if (data.alive) setAlive(true);
      } catch { /* server not ready yet */ }

      function connect() {
        if (disposed) return;
        if (esRef.current) esRef.current.close();

        const es = new EventSource(`${baseUrl}/events?since=${cursor}`);
        esRef.current = es;

        es.onopen = () => setConnected(true);

        es.onmessage = (e) => {
          if (!e.data || disposed) return;
          // Track cursor from SSE id
          if (e.lastEventId) cursor = parseInt(e.lastEventId, 10);
          try {
            const event: AgentEvent = JSON.parse(e.data);
            onEventRef.current?.(event);

            if (event.type === "init") onInitRef.current?.(event);
            if (event.type === "assistant") onAssistantRef.current?.(event);
            if (event.type === "complete") onCompleteRef.current?.(event);
            if (event.type === "error") onErrorRef.current?.(event);
          } catch { /* malformed */ }
        };

        es.onerror = () => {
          setConnected(false);
          es.close();
          if (!disposed) setTimeout(connect, 3000);
        };
      }

      connect();
    }

    init();

    return () => {
      disposed = true;
      esRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  // Send message to agent
  const send = useCallback(async (message: string) => {
    console.log(`[useAgent:send] baseUrl=${baseUrl}, message=${message.slice(0, 50)}`);
    setAlive(true);
    try {
      const res = await fetch(`${baseUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      console.log("[useAgent:send] response:", data);
      return data;
    } catch (err) {
      console.error("[useAgent:send] FAILED:", err);
      return { status: "error", message: String(err) };
    }
  }, [baseUrl]);

  // Start agent session (if not already running)
  const start = useCallback(async (prompt?: string) => {
    const res = await fetch(`${baseUrl}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, prompt, permissionMode }),
    });
    const data = await res.json();
    if (data.status === "started" || data.status === "already_running") {
      setAlive(true);
    }
    return data;
  }, [baseUrl, provider, permissionMode]);

  // Kill agent
  const kill = useCallback(async () => {
    setAlive(false);
    await fetch(`${baseUrl}/kill`, { method: "POST" });
  }, [baseUrl]);

  return { connected, alive, start, send, kill };
}
