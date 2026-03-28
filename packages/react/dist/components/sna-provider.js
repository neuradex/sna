"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { memo, useEffect, useState } from "react";
import { ChatPanel } from "./chat/chat-panel.js";
import { useChatStore } from "../stores/chat-store.js";
import { useSkillEvents } from "../hooks/use-skill-events.js";
import { useResponsiveChat } from "../hooks/use-responsive-chat.js";
import { SnaContext, DEFAULT_SNA_URL } from "../context.js";
const StableChatPanel = memo(function StableChatPanel2({
  onClose,
  sessionId = "default"
}) {
  return /* @__PURE__ */ jsx(ChatPanel, { onClose, sessionId });
});
function PermissionAutoOpen() {
  const setOpen = useChatStore((s) => s.setOpen);
  const chatOpen = useChatStore((s) => s.isOpen);
  useSkillEvents({
    enabled: !chatOpen,
    onNeedPermission: () => setOpen(true)
  });
  return null;
}
function ConnectingOverlay() {
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--sna-chat-bg, #0d0d14)",
        color: "#e0e0f0",
        fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace"
      },
      children: /* @__PURE__ */ jsxs("div", { style: { textAlign: "center" }, children: [
        /* @__PURE__ */ jsx("div", { style: { marginBottom: 16 }, children: /* @__PURE__ */ jsxs(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: "0 0 512 512",
            width: "48",
            height: "48",
            children: [
              /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsxs("linearGradient", { id: "sna-bolt-loading", x1: "0", y1: "0", x2: "0", y2: "1", children: [
                /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: "#fafafa" }),
                /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: "#c4b5fd" })
              ] }) }),
              /* @__PURE__ */ jsx("rect", { width: "512", height: "512", rx: "96", fill: "#2d2548" }),
              /* @__PURE__ */ jsx(
                "polygon",
                {
                  points: "332,56 192,272 284,272 178,460 340,232 248,232",
                  fill: "url(#sna-bolt-loading)",
                  stroke: "url(#sna-bolt-loading)",
                  strokeWidth: "8",
                  strokeLinejoin: "round",
                  paintOrder: "stroke fill"
                }
              )
            ]
          }
        ) }),
        /* @__PURE__ */ jsx("div", { style: { fontSize: 14, color: "rgba(255,255,255,0.7)" }, children: "Starting SNA Agent..." })
      ] })
    }
  );
}
function FloatingChatButton({ onClick }) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      onClick,
      style: {
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--sna-accent, #7c3aed)",
        border: "none",
        boxShadow: "0 4px 24px var(--sna-accent-glow, rgba(124,58,237,0.4))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 50,
        transition: "background 0.15s, transform 0.15s"
      },
      onMouseEnter: (e) => {
        e.currentTarget.style.background = "var(--sna-accent-hover, #8b5cf6)";
        e.currentTarget.style.transform = "scale(1.05)";
      },
      onMouseLeave: (e) => {
        e.currentTarget.style.background = "var(--sna-accent, #7c3aed)";
        e.currentTarget.style.transform = "scale(1)";
      },
      children: /* @__PURE__ */ jsx(
        "svg",
        {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 512 512",
          width: 20,
          height: 20,
          children: /* @__PURE__ */ jsx(
            "polygon",
            {
              points: "332,56 192,272 284,272 178,460 340,232 248,232",
              fill: "white",
              stroke: "white",
              strokeWidth: "8",
              strokeLinejoin: "round"
            }
          )
        }
      )
    }
  );
}
function SnaProvider({
  children,
  defaultOpen = false,
  dangerouslySkipPermissions = false,
  snaUrl,
  headless = false,
  initialSessionId = "default"
}) {
  const [agentReady, setAgentReady] = useState(headless);
  const [resolvedUrl, setResolvedUrl] = useState(snaUrl ?? "");
  const chatOpen = useChatStore((s) => s.isOpen);
  const setChatOpen = useChatStore((s) => s.setOpen);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const { mode } = useResponsiveChat();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const permissionMode = dangerouslySkipPermissions ? "bypassPermissions" : "acceptEdits";
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
      useChatStore.getState().hydrate();
      if (headless) return;
      fetch(`${url}/agent/start?session=${encodeURIComponent(initialSessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "claude-code", permissionMode })
      }).then((res) => res.json()).then(() => setAgentReady(true)).catch(() => setAgentReady(true));
    });
  }, [dangerouslySkipPermissions, snaUrl, headless, initialSessionId]);
  useEffect(() => {
    if (headless || typeof window === "undefined") return;
    if (!localStorage.getItem("sna-chat-panel")) {
      useChatStore.getState().setOpen(defaultOpen);
    }
  }, []);
  useEffect(() => {
    if (headless) return;
    function handleKeydown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        useChatStore.getState().toggle();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [headless]);
  if (headless) {
    return /* @__PURE__ */ jsx(SnaContext.Provider, { value: { apiUrl: resolvedUrl }, children });
  }
  const useFlex = chatOpen && mode === "side-by-side";
  return /* @__PURE__ */ jsxs(SnaContext.Provider, { value: { apiUrl: resolvedUrl }, children: [
    !agentReady && /* @__PURE__ */ jsx(ConnectingOverlay, {}),
    useFlex ? /* @__PURE__ */ jsxs("div", { style: { display: "flex", height: "100dvh" }, children: [
      /* @__PURE__ */ jsx("div", { style: { flex: 1, overflow: "auto", minWidth: 0 }, children }),
      /* @__PURE__ */ jsx(StableChatPanel, { onClose: () => setChatOpen(false), sessionId: activeSessionId })
    ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      children,
      chatOpen && /* @__PURE__ */ jsx(StableChatPanel, { onClose: () => setChatOpen(false), sessionId: activeSessionId })
    ] }),
    !chatOpen && /* @__PURE__ */ jsx(FloatingChatButton, { onClick: () => setChatOpen(true) }),
    /* @__PURE__ */ jsx(PermissionAutoOpen, {})
  ] });
}
export {
  SnaProvider
};
