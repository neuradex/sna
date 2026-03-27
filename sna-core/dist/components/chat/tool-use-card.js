"use client";
import { jsx, jsxs } from "react/jsx-runtime";
const TOOL_ICONS = {
  Read: "\u{1F4C4}",
  Edit: "\u270F\uFE0F",
  Write: "\u{1F4DD}",
  Bash: "\u2B1B",
  Glob: "\u{1F50D}",
  Grep: "\u{1F50E}",
  WebFetch: "\u{1F310}",
  WebSearch: "\u{1F310}",
  Agent: "\u{1F916}",
  Skill: "\u26A1"
};
function ToolUseCard({ message }) {
  const toolName = message.meta?.toolName ?? message.content;
  const input = message.meta?.input;
  const icon = TOOL_ICONS[toolName] ?? "\u{1F527}";
  let preview = "";
  if (input) {
    if (input.command) preview = String(input.command);
    else if (input.file_path) preview = String(input.file_path);
    else if (input.pattern) preview = String(input.pattern);
    else if (input.query) preview = String(input.query);
    else if (input.prompt) preview = String(input.prompt).substring(0, 80);
    else if (input.skill) preview = String(input.skill);
  }
  if (preview.length > 100) preview = preview.substring(0, 100) + "\u2026";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        background: "var(--sna-surface)",
        border: "1px solid var(--sna-surface-border)",
        borderRadius: "var(--sna-radius-lg)"
      },
      children: [
        /* @__PURE__ */ jsx("span", { style: { fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }, children: icon }),
        /* @__PURE__ */ jsxs("div", { style: { minWidth: 0 }, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                fontSize: 12,
                fontWeight: 600,
                color: "var(--sna-text-muted)",
                fontFamily: "var(--sna-font-mono)"
              },
              children: toolName
            }
          ),
          preview && /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                fontSize: 11,
                color: "var(--sna-text-faint)",
                fontFamily: "var(--sna-font-mono)",
                marginTop: 3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              children: preview
            }
          )
        ] })
      ]
    }
  );
}
export {
  ToolUseCard
};
