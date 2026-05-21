"use client";
import { jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useChatStore } from "../stores/chat-store.js";
import { SnaContext, DEFAULT_SNA_URL } from "../context.js";
function SnaProvider({
  children,
  connection,
  snaUrl,
  authToken,
  sessionId = "default",
  hydrate: shouldHydrate = true
}) {
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
        const discoveredToken = typeof data.authToken === "string" ? data.authToken : void 0;
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
      } catch {
      }
      const fallback = DEFAULT_SNA_URL;
      setResolvedUrl(fallback);
      setResolvedAuthToken(void 0);
      return { url: fallback, token: void 0 };
    }
    discover().then(({ url, token }) => {
      useChatStore.getState()._setApiUrl(url);
      useChatStore.getState()._setAuthToken(token);
      if (shouldHydrate) {
        useChatStore.getState().hydrate();
      }
    });
  }, [explicitUrl, explicitAuthToken, shouldHydrate]);
  return /* @__PURE__ */ jsx(SnaContext.Provider, { value: { apiUrl: resolvedUrl, authToken: resolvedAuthToken, sessionId }, children });
}
export {
  SnaProvider
};
