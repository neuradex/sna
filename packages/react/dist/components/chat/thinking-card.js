"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
function ThinkingCard({ message }) {
  const [expanded, setExpanded] = useState(false);
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: () => setExpanded(!expanded),
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--sna-text-faint)",
          fontSize: 11,
          fontFamily: "var(--sna-font-mono)"
        },
        children: [
          /* @__PURE__ */ jsx(
            "svg",
            {
              width: 8,
              height: 8,
              viewBox: "0 0 8 8",
              style: {
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s"
              },
              children: /* @__PURE__ */ jsx("path", { d: "M2 1L6 4L2 7", stroke: "currentColor", strokeWidth: "1.2", fill: "none", strokeLinecap: "round" })
            }
          ),
          message.meta?.done ? "Thought" : "Thinking..."
        ]
      }
    ),
    expanded && /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          marginTop: 2,
          padding: "4px 0 4px 24px",
          fontSize: 10,
          lineHeight: 1.5,
          color: "var(--sna-text-faint)",
          fontFamily: "var(--sna-font-mono)",
          whiteSpace: "pre-wrap",
          maxHeight: 200,
          overflowY: "auto",
          opacity: 0.7
        },
        children: message.content
      }
    )
  ] });
}
export {
  ThinkingCard
};
