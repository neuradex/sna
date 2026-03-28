"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from "react";
const MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6", tier: "max" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "fast" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", tier: "instant" }
];
function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function ModelDropdown({
  currentModel,
  onChange
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  const current = MODELS.find((m) => currentModel.includes(m.id));
  const label = current?.label ?? currentModel.split("[")[0].replace("claude-", "") ?? "Model";
  return /* @__PURE__ */ jsxs("div", { ref, style: { position: "relative" }, children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: () => setOpen(!open),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: "var(--sna-radius-md)",
          background: "var(--sna-surface)",
          border: "1px solid var(--sna-surface-border)",
          color: "var(--sna-text-muted)",
          fontSize: 11,
          fontFamily: "var(--sna-font-mono)",
          cursor: "pointer",
          whiteSpace: "nowrap"
        },
        children: [
          label,
          /* @__PURE__ */ jsx("svg", { width: 8, height: 8, viewBox: "0 0 8 8", style: { opacity: 0.5 }, children: /* @__PURE__ */ jsx("path", { d: "M1 3L4 6L7 3", stroke: "currentColor", strokeWidth: "1.2", fill: "none", strokeLinecap: "round" }) })
        ]
      }
    ),
    open && /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          position: "absolute",
          top: "calc(100% + 4px)",
          right: 0,
          minWidth: 160,
          background: "var(--sna-chat-bg)",
          border: "1px solid var(--sna-surface-border)",
          borderRadius: "var(--sna-radius-md)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          zIndex: 100,
          padding: 4
        },
        children: MODELS.map((m) => {
          const active = currentModel.includes(m.id);
          return /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => {
                onChange(m.id);
                setOpen(false);
              },
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "7px 10px",
                borderRadius: "var(--sna-radius-sm)",
                background: active ? "var(--sna-accent-soft)" : "transparent",
                border: "none",
                color: active ? "var(--sna-text)" : "var(--sna-text-secondary)",
                fontSize: 12,
                fontFamily: "var(--sna-font-mono)",
                cursor: "pointer",
                textAlign: "left"
              },
              onMouseEnter: (e) => {
                if (!active) e.target.style.background = "var(--sna-surface-hover)";
              },
              onMouseLeave: (e) => {
                if (!active) e.target.style.background = "transparent";
              },
              children: [
                /* @__PURE__ */ jsx("span", { children: m.label }),
                /* @__PURE__ */ jsx("span", { style: { fontSize: 10, color: "var(--sna-text-faint)" }, children: m.tier })
              ]
            },
            m.id
          );
        })
      }
    )
  ] });
}
function ChatHeader({ onClose, onClear, isRunning, sessionUsage, onModelChange, sessions, viewMode = "chat", bgCount = 0, bgSessionLabel, onViewChat, onViewBgDashboard, onViewBgBack }) {
  const { contextUsed, contextWindow, totalCost, cacheRead, model } = sessionUsage;
  const ctxPercent = contextWindow > 0 ? Math.min(contextUsed / contextWindow * 100, 100) : 0;
  const cachedPercent = contextUsed > 0 ? Math.round(cacheRead / contextUsed * 100) : 0;
  const uncached = contextUsed - cacheRead;
  const cachedBarPercent = contextWindow > 0 ? Math.min(cacheRead / contextWindow * 100, 100) : 0;
  const uncachedBarPercent = contextWindow > 0 ? Math.min(uncached / contextWindow * 100, 100) : 0;
  return /* @__PURE__ */ jsxs("div", { style: { borderBottom: "1px solid var(--sna-chat-border)", flexShrink: 0 }, children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        },
        children: [
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
            /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  width: 24,
                  height: 24,
                  borderRadius: "var(--sna-radius-sm)",
                  background: "var(--sna-accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                },
                children: /* @__PURE__ */ jsx("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 512 512", width: 14, height: 14, children: /* @__PURE__ */ jsx(
                  "polygon",
                  {
                    points: "332,56 192,272 284,272 178,460 340,232 248,232",
                    fill: "white",
                    stroke: "white",
                    strokeWidth: "8",
                    strokeLinejoin: "round"
                  }
                ) })
              }
            ),
            /* @__PURE__ */ jsx(ModelDropdown, { currentModel: model, onChange: onModelChange }),
            isRunning && /* @__PURE__ */ jsx(
              "span",
              {
                style: {
                  width: 8,
                  height: 8,
                  borderRadius: "var(--sna-radius-full)",
                  background: "var(--sna-success)",
                  animation: "sna-pulse 2s ease-in-out infinite"
                }
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: onClear,
                style: {
                  color: "var(--sna-text-icon)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center"
                },
                "aria-label": "Clear chat",
                title: "Clear chat",
                children: /* @__PURE__ */ jsx("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", children: /* @__PURE__ */ jsx(
                  "path",
                  {
                    d: "M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z",
                    stroke: "currentColor",
                    strokeWidth: "1.2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  }
                ) })
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: onClose,
                style: {
                  color: "var(--sna-text-icon)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center"
                },
                "aria-label": "Close chat",
                children: /* @__PURE__ */ jsx("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", children: /* @__PURE__ */ jsx("path", { d: "M4 4l8 8M12 4l-8 8", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }) })
              }
            )
          ] })
        ]
      }
    ),
    bgCount > 0 && /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 12px",
          borderBottom: "1px solid var(--sna-surface-border)",
          fontSize: 11,
          fontFamily: "var(--sna-font-mono)"
        },
        children: [
          viewMode === "bg-session" && /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: onViewBgBack,
              style: {
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--sna-text-muted)",
                padding: "4px 6px",
                fontSize: 11,
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 4
              },
              children: [
                /* @__PURE__ */ jsx("svg", { width: 10, height: 10, viewBox: "0 0 10 10", children: /* @__PURE__ */ jsx("path", { d: "M6 2L3 5L6 8", stroke: "currentColor", strokeWidth: "1.5", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }) }),
                "Back"
              ]
            }
          ),
          viewMode !== "bg-session" && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: onViewChat,
                style: {
                  padding: "4px 10px",
                  borderRadius: "var(--sna-radius-sm)",
                  background: viewMode === "chat" ? "var(--sna-accent-soft)" : "transparent",
                  border: "none",
                  color: viewMode === "chat" ? "var(--sna-text)" : "var(--sna-text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit"
                },
                children: "Chat"
              }
            ),
            /* @__PURE__ */ jsxs(
              "button",
              {
                onClick: onViewBgDashboard,
                style: {
                  padding: "4px 10px",
                  borderRadius: "var(--sna-radius-sm)",
                  background: viewMode === "bg-dashboard" ? "var(--sna-accent-soft)" : "transparent",
                  border: "none",
                  color: viewMode === "bg-dashboard" ? "var(--sna-text)" : "var(--sna-text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 5
                },
                children: [
                  "Background",
                  /* @__PURE__ */ jsx(
                    "span",
                    {
                      style: {
                        background: "var(--sna-accent)",
                        color: "#fff",
                        borderRadius: "var(--sna-radius-full)",
                        padding: "0 5px",
                        fontSize: 10,
                        lineHeight: "16px",
                        fontWeight: 600
                      },
                      children: bgCount
                    }
                  )
                ]
              }
            )
          ] }),
          viewMode === "bg-session" && bgSessionLabel && /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-text)", fontSize: 11 }, children: bgSessionLabel })
        ]
      }
    ),
    contextUsed > 0 && /* @__PURE__ */ jsxs("div", { style: { padding: "0 16px 8px" }, children: [
      /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            height: 3,
            borderRadius: 2,
            background: "var(--sna-surface)",
            overflow: "hidden",
            marginBottom: 6,
            display: "flex"
          },
          children: [
            /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  height: "100%",
                  width: `${cachedBarPercent}%`,
                  background: "var(--sna-success, #22c55e)",
                  opacity: 0.6,
                  transition: "width 0.3s ease"
                },
                title: `Cached: ${fmtTokens(cacheRead)}`
              }
            ),
            /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  height: "100%",
                  width: `${uncachedBarPercent}%`,
                  background: ctxPercent > 80 ? "var(--sna-error, #ef4444)" : "var(--sna-accent)",
                  transition: "width 0.3s ease"
                },
                title: `Uncached: ${fmtTokens(uncached)}`
              }
            )
          ]
        }
      ),
      /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 10,
            fontFamily: "var(--sna-font-mono)",
            color: "var(--sna-text-faint)"
          },
          children: [
            /* @__PURE__ */ jsxs("span", { title: `${fmtTokens(contextUsed)} / ${fmtTokens(contextWindow)}`, children: [
              fmtTokens(contextUsed),
              " / ",
              fmtTokens(contextWindow)
            ] }),
            /* @__PURE__ */ jsxs("span", { children: [
              ctxPercent.toFixed(0),
              "%"
            ] }),
            cachedPercent > 0 && /* @__PURE__ */ jsxs("span", { style: { color: "var(--sna-success, #22c55e)" }, title: `${fmtTokens(cacheRead)} cached`, children: [
              cachedPercent,
              "% cached"
            ] }),
            /* @__PURE__ */ jsxs("span", { title: "Session cost", style: { marginLeft: "auto" }, children: [
              "$",
              totalCost.toFixed(4)
            ] })
          ]
        }
      )
    ] })
  ] });
}
export {
  ChatHeader
};
