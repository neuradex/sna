"use client";

import { useEffect, useState } from "react";
import { useChatStore } from "../stores/chat-store.js";
import { SnaContext, DEFAULT_SNA_URL } from "../context.js";

interface SnaProviderProps {
  children: React.ReactNode;
  /**
   * Override the SNA internal API server URL.
   * Defaults to auto-discovery via /api/sna-port, then http://localhost:3099.
   */
  snaUrl?: string;
  /**
   * Session ID for this provider scope.
   * @default "default"
   */
  sessionId?: string;
}

/**
 * SnaProvider — provides SNA context (apiUrl + sessionId) to the app.
 *
 * This is a pure context provider. No UI, no peer deps beyond React.
 * For built-in chat UI, import and render <SnaChatUI /> separately.
 *
 * @example
 * // Minimal — context only
 * <SnaProvider snaUrl="http://localhost:52341">
 *   {children}
 * </SnaProvider>
 *
 * // With built-in chat UI
 * import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";
 * <SnaProvider>
 *   {children}
 *   <SnaChatUI />
 * </SnaProvider>
 *
 * // Multi-session with SnaSession
 * import { SnaSession } from "@sna-sdk/react/components/sna-session";
 * <SnaProvider snaUrl={apiUrl}>
 *   <SnaSession id="default"><HelperAgent /></SnaSession>
 *   <SnaSession id={projectSessionId}><ChatArea /></SnaSession>
 * </SnaProvider>
 */
export function SnaProvider({
  children,
  snaUrl,
  sessionId = "default",
}: SnaProviderProps) {
  const [resolvedUrl, setResolvedUrl] = useState(snaUrl ?? "");

  useEffect(() => {
    if (typeof window === "undefined") return;

    async function discover() {
      if (snaUrl) {
        setResolvedUrl(snaUrl);
        return snaUrl;
      }
      try {
        const res = await fetch("/api/sna-port");
        const data = await res.json();
        if (data.port) {
          const url = `http://localhost:${data.port}`;
          setResolvedUrl(url);
          return url;
        }
      } catch { /* no endpoint */ }
      const fallback = DEFAULT_SNA_URL;
      setResolvedUrl(fallback);
      return fallback;
    }

    discover().then((url) => {
      useChatStore.getState()._setApiUrl(url);
      useChatStore.getState().hydrate();
    });
  }, [snaUrl]);

  return (
    <SnaContext.Provider value={{ apiUrl: resolvedUrl, sessionId }}>
      {children}
    </SnaContext.Provider>
  );
}
