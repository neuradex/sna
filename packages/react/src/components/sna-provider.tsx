"use client";

import { useEffect, useState } from "react";
import { useChatStore } from "../stores/chat-store.js";
import { SnaContext, DEFAULT_SNA_URL } from "../context.js";

export interface SnaConnection {
  baseUrl: string;
  authToken?: string;
}

export interface SnaProviderProps {
  children: React.ReactNode;
  /**
   * Connection object returned by startSnaServer/startSnaServerInProcess.
   * Prefer this in SDK-managed apps so the auth token stays paired with
   * the server handle.
   */
  connection?: SnaConnection;
  /**
   * Override the SNA internal API server URL.
   * Defaults to auto-discovery via /api/sna-port, then http://localhost:3099.
   */
  snaUrl?: string;
  /** Bearer token override for custom deployments. Prefer `connection`. */
  authToken?: string;
  /**
   * Session ID for this provider scope.
   * @default "default"
   */
  sessionId?: string;
  /**
   * Whether to hydrate chat sessions on mount.
   * Set to false if your app doesn't use the chat store.
   * @default true
   */
  hydrate?: boolean;
}

/**
 * SnaProvider — provides SNA context (apiUrl + sessionId) to the app.
 *
 * This is a pure context provider. No UI, no peer deps beyond React.
 * For built-in chat UI, import and render <SnaChatUI /> separately.
 *
 * @example
 * // Minimal — context only
 * <SnaProvider connection={sna.connection}>
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
  connection,
  snaUrl,
  authToken,
  sessionId = "default",
  hydrate: shouldHydrate = true,
}: SnaProviderProps) {
  const explicitUrl = connection?.baseUrl ?? snaUrl;
  const explicitAuthToken = connection?.authToken ?? authToken;
  const [resolvedUrl, setResolvedUrl] = useState(explicitUrl ?? "");
  const [resolvedAuthToken, setResolvedAuthToken] = useState(explicitAuthToken);

  useEffect(() => {
    if (typeof window === "undefined") return;

    async function discover() {
      if (explicitUrl) {
        setResolvedUrl(explicitUrl);
        setResolvedAuthToken(explicitAuthToken);
        return { url: explicitUrl, token: explicitAuthToken };
      }
      try {
        const res = await fetch("/api/sna-port");
        const data = await res.json();
        const discoveredToken = typeof data.authToken === "string" ? data.authToken : undefined;
        if (typeof data.baseUrl === "string") {
          setResolvedUrl(data.baseUrl);
          setResolvedAuthToken(discoveredToken);
          return { url: data.baseUrl, token: discoveredToken };
        }
        if (data.port) {
          const url = `http://localhost:${data.port}`;
          setResolvedUrl(url);
          setResolvedAuthToken(discoveredToken);
          return { url, token: discoveredToken };
        }
      } catch { /* no endpoint */ }
      const fallback = DEFAULT_SNA_URL;
      setResolvedUrl(fallback);
      setResolvedAuthToken(undefined);
      return { url: fallback, token: undefined };
    }

    discover().then(({ url, token }) => {
      useChatStore.getState()._setApiUrl(url);
      useChatStore.getState()._setAuthToken(token);
      if (shouldHydrate) {
        useChatStore.getState().hydrate();
      }
    });
  }, [explicitUrl, explicitAuthToken, shouldHydrate]);

  return (
    <SnaContext.Provider value={{ apiUrl: resolvedUrl, authToken: resolvedAuthToken, sessionId }}>
      {children}
    </SnaContext.Provider>
  );
}
