"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from "react";
function ChatInput({ onSend, disabled }) {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [text]);
  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
  };
  return /* @__PURE__ */ jsxs("div", { style: { borderTop: "1px solid var(--sna-chat-border)", padding: 12, flexShrink: 0 }, children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          background: "var(--sna-surface)",
          border: "1px solid var(--sna-surface-border)",
          borderRadius: "var(--sna-radius-lg)",
          padding: "8px 12px"
        },
        children: [
          /* @__PURE__ */ jsx(
            "textarea",
            {
              ref: textareaRef,
              value: text,
              onChange: (e) => setText(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              },
              placeholder: "Ask Claude or run a skill...",
              rows: 1,
              disabled,
              style: {
                flex: 1,
                background: "transparent",
                fontSize: 14,
                color: "var(--sna-text)",
                resize: "none",
                outline: "none",
                border: "none",
                minHeight: 20,
                maxHeight: 120,
                lineHeight: 1.5,
                fontFamily: "var(--sna-font-sans)",
                padding: 0
              }
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: handleSend,
              disabled: disabled || !text.trim(),
              style: {
                width: 32,
                height: 32,
                borderRadius: "var(--sna-radius-md)",
                background: "var(--sna-accent)",
                border: "none",
                cursor: disabled || !text.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                opacity: disabled || !text.trim() ? 0.3 : 1,
                transition: "background 0.15s, opacity 0.15s"
              },
              children: /* @__PURE__ */ jsx("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", children: /* @__PURE__ */ jsx(
                "path",
                {
                  d: "M7 12V2M7 2L3 6M7 2l4 4",
                  stroke: "white",
                  strokeWidth: "1.5",
                  strokeLinecap: "round",
                  strokeLinejoin: "round"
                }
              ) })
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx("div", { style: { padding: "8px 4px 0", display: "flex", alignItems: "center" }, children: /* @__PURE__ */ jsx(
      "span",
      {
        style: {
          color: "var(--sna-text-faint)",
          fontSize: 10,
          fontFamily: "var(--sna-font-mono)"
        },
        children: disabled ? "Running..." : "Enter to send \xB7 Shift+Enter for newline"
      }
    ) })
  ] });
}
export {
  ChatInput
};
