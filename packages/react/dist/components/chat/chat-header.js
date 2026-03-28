"use client";
import { jsx, jsxs } from "react/jsx-runtime";
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
function ChatHeader({ onClose, onClear, isRunning, sessionUsage, onModelChange, sessions, activeSessionId, onSessionChange, onSessionClose }) {
  const { totalInputTokens, totalOutputTokens, totalCost, contextWindow, lastTurnContextTokens, lastTurnSystemTokens, lastTurnConvTokens, model } = sessionUsage;
  const totalTokens = totalInputTokens + totalOutputTokens;
  const ctxPercent = contextWindow > 0 ? Math.min(lastTurnContextTokens / contextWindow * 100, 100) : 0;
  const sysPercent = contextWindow > 0 ? Math.min(lastTurnSystemTokens / contextWindow * 100, 100) : 0;
  const convPercent = contextWindow > 0 ? Math.min(lastTurnConvTokens / contextWindow * 100, 100) : 0;
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
    sessions && sessions.length > 1 && (() => {
      const bgSessions = sessions.filter((s) => s.id !== "default");
      const isOnBg = activeSessionId !== "default";
      const currentBg = isOnBg ? sessions.find((s) => s.id === activeSessionId) : null;
      return /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderBottom: "1px solid var(--sna-surface-border)",
            fontSize: 11,
            fontFamily: "var(--sna-font-mono)"
          },
          children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => onSessionChange?.("default"),
                style: {
                  padding: "4px 10px",
                  borderRadius: "var(--sna-radius-sm)",
                  background: !isOnBg ? "var(--sna-accent-soft)" : "transparent",
                  border: "none",
                  color: !isOnBg ? "var(--sna-text)" : "var(--sna-text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit"
                },
                children: "Chat"
              }
            ),
            /* @__PURE__ */ jsx("div", { style: { position: "relative" }, children: /* @__PURE__ */ jsxs(
              "select",
              {
                value: isOnBg ? activeSessionId : "",
                onChange: (e) => {
                  if (e.target.value) onSessionChange?.(e.target.value);
                },
                style: {
                  padding: "4px 8px",
                  paddingRight: 20,
                  borderRadius: "var(--sna-radius-sm)",
                  background: isOnBg ? "var(--sna-accent-soft)" : "var(--sna-surface)",
                  border: "1px solid var(--sna-surface-border)",
                  color: isOnBg ? "var(--sna-text)" : "var(--sna-text-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  appearance: "none",
                  WebkitAppearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='8' viewBox='0 0 8 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 3L4 6L7 3' stroke='%23888' stroke-width='1.2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 6px center"
                },
                children: [
                  /* @__PURE__ */ jsxs("option", { value: "", disabled: isOnBg, children: [
                    "Background ",
                    bgSessions.length
                  ] }),
                  bgSessions.map((s) => /* @__PURE__ */ jsx("option", { value: s.id, children: s.label }, s.id))
                ]
              }
            ) }),
            isOnBg && currentBg && /* @__PURE__ */ jsx(
              "button",
              {
                onClick: () => {
                  onSessionClose?.(currentBg.id);
                  onSessionChange?.("default");
                },
                style: {
                  background: "none",
                  border: "none",
                  color: "var(--sna-text-faint)",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "2px 4px"
                },
                title: "Close this background session",
                children: "\xD7"
              }
            )
          ]
        }
      );
    })(),
    lastTurnContextTokens > 0 && /* @__PURE__ */ jsxs("div", { style: { padding: "0 16px 8px" }, children: [
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
                  width: `${sysPercent}%`,
                  background: "rgba(255,255,255,0.10)",
                  transition: "width 0.3s ease"
                },
                title: `System: ${fmtTokens(lastTurnSystemTokens)} (tools, prompts, project files)`
              }
            ),
            /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  height: "100%",
                  width: `${convPercent}%`,
                  background: "var(--sna-accent)",
                  transition: "width 0.3s ease"
                },
                title: `Conversation: ${fmtTokens(lastTurnConvTokens)}`
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
            /* @__PURE__ */ jsxs(
              "span",
              {
                style: { display: "flex", alignItems: "center", gap: 4 },
                title: "System overhead: tools, prompts, project files",
                children: [
                  /* @__PURE__ */ jsx("span", { style: { display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" } }),
                  "sys ",
                  fmtTokens(lastTurnSystemTokens)
                ]
              }
            ),
            /* @__PURE__ */ jsxs(
              "span",
              {
                style: { display: "flex", alignItems: "center", gap: 4 },
                title: "Conversation tokens (your messages + responses)",
                children: [
                  /* @__PURE__ */ jsx("span", { style: { display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "var(--sna-accent)" } }),
                  "conv ",
                  fmtTokens(lastTurnConvTokens)
                ]
              }
            ),
            contextWindow > 0 && /* @__PURE__ */ jsxs("span", { title: `${fmtTokens(lastTurnContextTokens)} / ${fmtTokens(contextWindow)}`, children: [
              ctxPercent.toFixed(0),
              "%"
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
