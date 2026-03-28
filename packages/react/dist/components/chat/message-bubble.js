"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { MarkdownContent } from "./markdown-content.js";
import { ThinkingCard } from "./thinking-card.js";
import { ToolUseCard } from "./tool-use-card.js";
import { SkillCard } from "./skill-card.js";
import { Tooltip } from "./tooltip.js";
const bubbleBase = {
  padding: "10px 16px",
  fontSize: 14,
  lineHeight: 1.5,
  maxWidth: "85%",
  wordBreak: "break-word"
};
function AssistantBubble({ message, isLast = false }) {
  const animate = !!message.meta?.animate;
  const text = message.content;
  const costLabel = message.meta?.costLabel ?? "";
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : Infinity);
  const [done, setDone] = useState(!animate);
  const wordsRef = useRef([]);
  useEffect(() => {
    if (!animate) {
      setDone(true);
      return;
    }
    const words = text.split(/(\s+)/);
    wordsRef.current = words;
    const total = words.length;
    const speed = total > 400 ? 5 : total > 200 ? 10 : total > 80 ? 18 : 25;
    let i = 0;
    const timer = setInterval(() => {
      i += 2;
      if (i >= total) {
        i = total;
        clearInterval(timer);
        setDone(true);
      }
      setVisibleCount(i);
    }, speed);
    return () => clearInterval(timer);
  }, [text, animate]);
  const visibleText = done ? text : wordsRef.current.slice(0, visibleCount).join("");
  return /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "flex-start" }, className: "sna-msg-bubble", children: /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        ...bubbleBase,
        padding: "4px 0",
        background: "none",
        color: "var(--sna-text-secondary)",
        cursor: done ? void 0 : "pointer",
        maxWidth: "100%"
      },
      onClick: () => {
        if (!done) {
          setVisibleCount(Infinity);
          setDone(true);
        }
      },
      title: done ? void 0 : "Click to skip animation",
      children: [
        /* @__PURE__ */ jsx(MarkdownContent, { text: visibleText }),
        done && costLabel && !isLast && /* @__PURE__ */ jsx(Tooltip, { content: costLabel, children: /* @__PURE__ */ jsx("span", { style: { display: "inline-block", marginLeft: 4, opacity: 0.2, cursor: "default", verticalAlign: "middle" }, children: /* @__PURE__ */ jsxs("svg", { width: 11, height: 11, viewBox: "0 0 16 16", style: { verticalAlign: "middle" }, children: [
          /* @__PURE__ */ jsx("circle", { cx: "8", cy: "8", r: "7", stroke: "currentColor", strokeWidth: "1.5", fill: "none" }),
          /* @__PURE__ */ jsx("path", { d: "M8 7v4M8 5v.5", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" })
        ] }) }) }),
        !done && /* @__PURE__ */ jsx(
          "span",
          {
            style: {
              display: "inline-block",
              width: 2,
              height: "1em",
              background: "var(--sna-accent)",
              marginLeft: 2,
              verticalAlign: "text-bottom",
              animation: "sna-pulse 1s infinite"
            }
          }
        ),
        done && costLabel && isLast && /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              marginTop: 6,
              paddingTop: 4,
              borderTop: "1px solid rgba(255,255,255,0.04)",
              fontSize: 10,
              fontFamily: "var(--sna-font-mono)",
              color: "var(--sna-text-faint)",
              textAlign: "left"
            },
            children: costLabel
          }
        )
      ]
    }
  ) });
}
const sIco = { stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
function IconCheck() {
  return /* @__PURE__ */ jsx("svg", { width: 12, height: 12, viewBox: "0 0 24 24", ...sIco, children: /* @__PURE__ */ jsx("path", { d: "M5 12l5 5L20 7" }) });
}
function IconX() {
  return /* @__PURE__ */ jsx("svg", { width: 12, height: 12, viewBox: "0 0 24 24", ...sIco, children: /* @__PURE__ */ jsx("path", { d: "M18 6L6 18M6 6l12 12" }) });
}
function IconAlertTriangle() {
  return /* @__PURE__ */ jsxs("svg", { width: 14, height: 14, viewBox: "0 0 24 24", ...sIco, children: [
    /* @__PURE__ */ jsx("path", { d: "M12 9v4" }),
    /* @__PURE__ */ jsx("path", { d: "M12 17h.01" }),
    /* @__PURE__ */ jsx("path", { d: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" })
  ] });
}
function ToolResultCard({ message }) {
  const [expanded, setExpanded] = useState(false);
  const isError = !!message.meta?.isError;
  const content = message.content;
  const isLong = content.length > 120;
  const display = expanded || !isLong ? content : content.slice(0, 120) + "...";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      onClick: () => isLong && setExpanded(!expanded),
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 5,
        padding: "1px 0 1px 24px",
        cursor: isLong ? "pointer" : void 0
      },
      children: [
        /* @__PURE__ */ jsx("span", { style: { color: isError ? "var(--sna-error-text)" : "var(--sna-text-faint)", flexShrink: 0, marginTop: 1, display: "flex", opacity: 0.7 }, children: isError ? /* @__PURE__ */ jsx(IconX, {}) : /* @__PURE__ */ jsx(IconCheck, {}) }),
        /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              fontSize: 10,
              fontFamily: "var(--sna-font-mono)",
              color: isError ? "var(--sna-error-text)" : "var(--sna-text-faint)",
              whiteSpace: "pre-wrap",
              lineHeight: 1.4,
              wordBreak: "break-all",
              minWidth: 0,
              opacity: 0.7
            },
            children: display
          }
        )
      ]
    }
  );
}
function MessageBubble({ message, isLast = false }) {
  switch (message.role) {
    case "user":
      return /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "flex-end" }, children: /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            ...bubbleBase,
            background: "var(--sna-accent-soft)",
            border: "1px solid var(--sna-accent-soft-border)",
            borderRadius: "var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-sm) var(--sna-radius-xl)",
            color: "var(--sna-text)"
          },
          children: message.content
        }
      ) });
    case "assistant":
      return /* @__PURE__ */ jsx(AssistantBubble, { message, isLast });
    case "thinking":
      return /* @__PURE__ */ jsx(ThinkingCard, { message });
    case "tool":
      return /* @__PURE__ */ jsx(ToolUseCard, { message });
    case "tool_result":
      return /* @__PURE__ */ jsx(ToolResultCard, { message });
    case "status":
      return /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "center" }, children: /* @__PURE__ */ jsx(
        "span",
        {
          style: {
            color: "var(--sna-text-faint)",
            fontSize: 10,
            fontFamily: "var(--sna-font-mono)",
            padding: "2px 0"
          },
          children: message.content
        }
      ) });
    case "permission":
      return /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            border: "1px solid var(--sna-warning-border)",
            background: "var(--sna-warning-bg)",
            borderRadius: "var(--sna-radius-lg)",
            padding: 16
          },
          children: /* @__PURE__ */ jsx("p", { style: { color: "var(--sna-warning-text)", fontSize: 14, margin: 0 }, children: message.content })
        }
      );
    case "error":
      return /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            background: "var(--sna-error-bg)",
            border: "1px solid var(--sna-error-border)",
            borderRadius: "var(--sna-radius-md)"
          },
          children: [
            /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-error-text)", flexShrink: 0, marginTop: 1, display: "flex" }, children: /* @__PURE__ */ jsx(IconAlertTriangle, {}) }),
            /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-error-text)", fontSize: 12, lineHeight: 1.5 }, children: message.content })
          ]
        }
      );
    case "skill":
      return /* @__PURE__ */ jsx(SkillCard, { message });
  }
}
export {
  MessageBubble
};
