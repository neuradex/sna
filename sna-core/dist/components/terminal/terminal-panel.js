"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { lazy, Suspense, useRef, useCallback, useEffect } from "react";
import { useTerminalStore } from "../../stores/terminal-store.js";
import { wsManager } from "../../lib/terminal/ws-manager.js";
import {
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MAX_HEIGHT_RATIO,
  TERMINAL_SNAP_THRESHOLD,
  TERMINAL_BAR_HEIGHT
} from "../../lib/terminal/constants.js";
import { SettingsMenu } from "./settings-menu.js";
const Terminal = lazy(() => import("./terminal.js").then((m) => ({ default: m.Terminal })));
function TerminalPanel({ dangerouslySkipPermissions = false }) {
  const { height, connected, isOpen, isConnecting, setHeight, setOpen } = useTerminalStore();
  const isDragging = useRef(false);
  const terminalMounted = true;
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const handleDragStart = useCallback(
    (e) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = isOpen ? height : 0;
      const onMove = (e2) => {
        if (!isDragging.current) return;
        const delta = dragStartY.current - e2.clientY;
        const newHeight = dragStartHeight.current + delta;
        if (newHeight < TERMINAL_SNAP_THRESHOLD) {
          setOpen(false);
        } else {
          const max = window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO;
          setHeight(Math.max(TERMINAL_MIN_HEIGHT, Math.min(max, newHeight)));
          setOpen(true);
        }
      };
      const onUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height, isOpen, setHeight, setOpen]
  );
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      useTerminalStore.getState().fitFn?.();
      useTerminalStore.getState().focusFn?.();
    }, 50);
    return () => clearTimeout(t);
  }, [isOpen]);
  useEffect(() => {
    const handler = (e) => {
      if (e.altKey && e.code === "Backquote") {
        e.preventDefault();
        setOpen(!useTerminalStore.getState().isOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      "div",
      {
        className: "fixed inset-0 z-40 transition-opacity duration-200",
        style: {
          backgroundColor: "rgba(0,0,0,0.8)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none"
        },
        onClick: () => setOpen(false)
      }
    ),
    /* @__PURE__ */ jsxs(
      "div",
      {
        className: "fixed bottom-0 left-0 right-0 z-50 flex flex-col",
        style: {
          backgroundColor: "#0d0d14",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          height: isOpen ? height + TERMINAL_BAR_HEIGHT : TERMINAL_BAR_HEIGHT,
          transition: isDragging.current ? "none" : "height 0.2s ease"
        },
        children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              onMouseDown: handleDragStart,
              className: "absolute top-0 left-0 right-0 z-10",
              style: { height: 4, cursor: "row-resize" }
            }
          ),
          /* @__PURE__ */ jsxs(
            "div",
            {
              className: "relative z-10 flex items-center justify-between shrink-0 cursor-pointer select-none",
              style: {
                height: TERMINAL_BAR_HEIGHT,
                backgroundColor: "#1a1a2e",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                padding: "0 16px"
              },
              onClick: () => setOpen(!isOpen),
              children: [
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
                  /* @__PURE__ */ jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 512 512", width: "16", height: "16", style: { flexShrink: 0 }, children: [
                    /* @__PURE__ */ jsx("defs", { children: /* @__PURE__ */ jsxs("linearGradient", { id: "sna-bolt-grad", x1: "0", y1: "0", x2: "0", y2: "1", children: [
                      /* @__PURE__ */ jsx("stop", { offset: "0%", stopColor: "#fafafa" }),
                      /* @__PURE__ */ jsx("stop", { offset: "100%", stopColor: "#c4b5fd" })
                    ] }) }),
                    /* @__PURE__ */ jsx("rect", { width: "512", height: "512", rx: "96", fill: "#2d2548" }),
                    /* @__PURE__ */ jsx("polygon", { points: "332,56 192,272 284,272 178,460 340,232 248,232", fill: "url(#sna-bolt-grad)", stroke: "url(#sna-bolt-grad)", strokeWidth: "8", strokeLinejoin: "round", paintOrder: "stroke fill" })
                  ] }),
                  /* @__PURE__ */ jsx("span", { style: { fontSize: 12, fontWeight: 500, color: "#fff" }, children: "SNA Console" }),
                  /* @__PURE__ */ jsx("span", { style: { fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: 8 }, children: "Claude Code" })
                ] }),
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [
                  /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
                    /* @__PURE__ */ jsx("span", { style: {
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: connected ? "#34d399" : isConnecting ? "#facc15" : "rgba(255,255,255,0.3)",
                      display: "inline-block"
                    } }),
                    /* @__PURE__ */ jsx("span", { style: { fontSize: 10, color: "rgba(255,255,255,0.7)" }, children: connected ? "ready" : isConnecting ? "connecting\u2026" : "offline" })
                  ] }),
                  /* @__PURE__ */ jsxs(
                    "button",
                    {
                      title: "Restart terminal",
                      onClick: (e) => {
                        e.stopPropagation();
                        wsManager.restart();
                      },
                      style: {
                        background: "rgba(255,255,255,0.07)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        cursor: "pointer",
                        padding: "3px 8px",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        color: "rgba(255,255,255,0.7)",
                        fontSize: 11
                      },
                      onMouseEnter: (e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                        e.currentTarget.style.color = "#fff";
                      },
                      onMouseLeave: (e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                        e.currentTarget.style.color = "rgba(255,255,255,0.7)";
                      },
                      children: [
                        /* @__PURE__ */ jsxs("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [
                          /* @__PURE__ */ jsx("path", { d: "M21 2v6h-6" }),
                          /* @__PURE__ */ jsx("path", { d: "M3 12a9 9 0 0 1 15-6.7L21 8" }),
                          /* @__PURE__ */ jsx("path", { d: "M3 22v-6h6" }),
                          /* @__PURE__ */ jsx("path", { d: "M21 12a9 9 0 0 1-15 6.7L3 16" })
                        ] }),
                        /* @__PURE__ */ jsx("span", { children: "Restart" })
                      ]
                    }
                  ),
                  /* @__PURE__ */ jsx(SettingsMenu, {}),
                  /* @__PURE__ */ jsx("span", { style: {
                    fontSize: 10,
                    color: "rgba(255,255,255,0.7)",
                    display: "inline-block",
                    transform: isOpen ? "rotate(0deg)" : "rotate(180deg)",
                    transition: "transform 0.2s"
                  }, children: "\u25BC" })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              className: "flex-1 overflow-hidden",
              style: {
                display: "flex",
                visibility: isOpen ? "visible" : "hidden",
                height: isOpen ? void 0 : 1,
                overflow: isOpen ? void 0 : "hidden"
              },
              onClick: (e) => e.stopPropagation(),
              children: terminalMounted && /* @__PURE__ */ jsx(Suspense, { fallback: null, children: /* @__PURE__ */ jsx(Terminal, { dangerouslySkipPermissions }) })
            }
          )
        ]
      }
    )
  ] });
}
export {
  TerminalPanel
};
