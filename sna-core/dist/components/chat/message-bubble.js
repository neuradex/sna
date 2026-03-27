"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { ToolUseCard } from "./tool-use-card.js";
import { SkillCard } from "./skill-card.js";
const bubbleBase = {
  padding: "10px 16px",
  fontSize: 14,
  lineHeight: 1.5,
  maxWidth: "85%",
  wordBreak: "break-word"
};
function MessageBubble({ message, onPermissionApprove, onPermissionDeny }) {
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
      return /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "flex-start" }, children: /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            ...bubbleBase,
            background: "var(--sna-surface)",
            border: "1px solid var(--sna-surface-border)",
            borderRadius: "var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-sm)",
            color: "var(--sna-text-secondary)"
          },
          children: message.content
        }
      ) });
    case "status":
      return /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "center" }, children: /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: "var(--sna-radius-full)",
            background: "var(--sna-surface)",
            border: "1px solid var(--sna-surface-border)"
          },
          children: [
            /* @__PURE__ */ jsx(
              "span",
              {
                style: {
                  width: 6,
                  height: 6,
                  borderRadius: "var(--sna-radius-full)",
                  background: "var(--sna-success)",
                  flexShrink: 0
                }
              }
            ),
            /* @__PURE__ */ jsx(
              "span",
              {
                style: {
                  color: "var(--sna-text-muted)",
                  fontSize: 12,
                  fontFamily: "var(--sna-font-mono)"
                },
                children: message.content
              }
            )
          ]
        }
      ) });
    case "permission":
      return /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            border: "1px solid var(--sna-warning-border)",
            background: "var(--sna-warning-bg)",
            borderRadius: "var(--sna-radius-lg)",
            padding: 16
          },
          children: [
            /* @__PURE__ */ jsx("p", { style: { color: "var(--sna-warning-text)", fontSize: 14, margin: "0 0 12px 0" }, children: message.content }),
            /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: onPermissionApprove,
                  style: {
                    padding: "6px 12px",
                    borderRadius: "var(--sna-radius-md)",
                    background: "var(--sna-success-approve)",
                    border: "none",
                    color: "white",
                    fontSize: 12,
                    cursor: "pointer"
                  },
                  children: "Approve"
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: onPermissionDeny,
                  style: {
                    padding: "6px 12px",
                    borderRadius: "var(--sna-radius-md)",
                    background: "none",
                    border: "1px solid var(--sna-surface-border)",
                    color: "var(--sna-text-muted)",
                    fontSize: 12,
                    cursor: "pointer"
                  },
                  children: "Deny"
                }
              )
            ] })
          ]
        }
      );
    case "error":
      return /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            border: "1px solid var(--sna-error-border)",
            background: "var(--sna-error-bg)",
            borderRadius: "var(--sna-radius-lg)",
            padding: "10px 16px"
          },
          children: /* @__PURE__ */ jsx("p", { style: { color: "var(--sna-error-text)", fontSize: 14, margin: 0 }, children: message.content })
        }
      );
    case "tool":
      return /* @__PURE__ */ jsx(ToolUseCard, { message });
    case "skill":
      return /* @__PURE__ */ jsx(SkillCard, { message });
  }
}
export {
  MessageBubble
};
