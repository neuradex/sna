"use client";
import { jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useChatStore } from "../stores/chat-store.js";
import { SnaContext, DEFAULT_SNA_URL } from "../context.js";
function SnaProvider({
  children,
  snaUrl,
  authToken,
  sessionId = "default",
  hydrate: shouldHydrate = true
}) {
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
      } catch {
      }
      const fallback = DEFAULT_SNA_URL;
      setResolvedUrl(fallback);
      return fallback;
    }
    discover().then((url) => {
      useChatStore.getState()._setApiUrl(url);
      useChatStore.getState()._setAuthToken(authToken);
      if (shouldHydrate) {
        useChatStore.getState().hydrate();
      }
    });
  }, [snaUrl, authToken, shouldHydrate]);
  return /* @__PURE__ */ jsx(SnaContext.Provider, { value: { apiUrl: resolvedUrl, authToken, sessionId }, children });
}
export {
  SnaProvider
};
