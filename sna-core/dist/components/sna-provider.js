"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { memo, useEffect } from "react";
import { TerminalPanel } from "./terminal/terminal-panel.js";
import { useTerminalStore } from "../stores/terminal-store.js";
import { useSkillEvents } from "../hooks/use-skill-events.js";
import { wsManager } from "../lib/terminal/ws-manager.js";
import { TERMINAL_BAR_HEIGHT } from "../lib/terminal/constants.js";
const StableTerminalPanel = memo(function StableTerminalPanel2({ dangerouslySkipPermissions }) {
  return /* @__PURE__ */ jsx(TerminalPanel, { dangerouslySkipPermissions });
});
function PermissionAutoOpen() {
  const setOpen = useTerminalStore((s) => s.setOpen);
  useSkillEvents({
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
        backgroundColor: "#0d0d14",
        color: "#e0e0f0",
        fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace"
      },
      children: /* @__PURE__ */ jsxs("div", { style: { textAlign: "center" }, children: [
        /* @__PURE__ */ jsx("div", { style: { marginBottom: 16 }, children: /* @__PURE__ */ jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 512 512", width: "48", height: "48", children: [
          /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsxs("linearGradient", { id: "sna-bolt-loading", x1: "0", y1: "0", x2: "0", y2: "1", children: [
            /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: "#fafafa" }),
            /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: "#c4b5fd" })
          ] }) }),
          /* @__PURE__ */ jsx("rect", { width: "512", height: "512", rx: "96", fill: "#2d2548" }),
          /* @__PURE__ */ jsx("polygon", { points: "332,56 192,272 284,272 178,460 340,232 248,232", fill: "url(#sna-bolt-loading)", stroke: "url(#sna-bolt-loading)", strokeWidth: "8", strokeLinejoin: "round", paintOrder: "stroke fill" })
        ] }) }),
        /* @__PURE__ */ jsx("div", { style: { fontSize: 14, color: "rgba(255,255,255,0.7)" }, children: "Connecting to Claude Code..." })
      ] })
    }
  );
}
function SnaProvider({
  children,
  defaultOpen = false,
  dangerouslySkipPermissions = false
}) {
  const connected = useTerminalStore((s) => s.connected);
  useEffect(() => {
    if (typeof window === "undefined") return;
    wsManager.connect({ dangerouslySkipPermissions });
    const unsub = wsManager.subscribe({
      onOpen: () => {
        useTerminalStore.getState().setConnected(true);
        useTerminalStore.getState().setIsConnecting(false);
      },
      onClose: () => {
        useTerminalStore.getState().setConnected(false);
      },
      onConnecting: () => {
        useTerminalStore.getState().setIsConnecting(true);
      }
    });
    return unsub;
  }, [dangerouslySkipPermissions]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.style.setProperty("--sna-bar-height", `${TERMINAL_BAR_HEIGHT}px`);
    if (!localStorage.getItem("terminal-panel")) {
      useTerminalStore.getState().setOpen(defaultOpen);
    }
  }, []);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    !connected && /* @__PURE__ */ jsx(ConnectingOverlay, {}),
    children,
    /* @__PURE__ */ jsx(PermissionAutoOpen, {}),
    /* @__PURE__ */ jsx(StableTerminalPanel, { dangerouslySkipPermissions })
  ] });
}
export {
  SnaProvider
};
