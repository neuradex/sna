"use client";

import type { ChatMessage } from "../../stores/chat-store.js";

const TOOL_ICONS: Record<string, string> = {
  Read: "📄",
  Edit: "✏️",
  Write: "📝",
  Bash: "⬛",
  Glob: "🔍",
  Grep: "🔎",
  WebFetch: "🌐",
  WebSearch: "🌐",
  Agent: "🤖",
  Skill: "⚡",
};

export function ToolUseCard({ message }: { message: ChatMessage }) {
  const toolName = (message.meta?.toolName as string) ?? message.content;
  const input = message.meta?.input as Record<string, unknown> | undefined;
  const icon = TOOL_ICONS[toolName] ?? "🔧";

  // Extract a short preview of the tool input
  let preview = "";
  if (input) {
    if (input.command) preview = String(input.command);
    else if (input.file_path) preview = String(input.file_path);
    else if (input.pattern) preview = String(input.pattern);
    else if (input.query) preview = String(input.query);
    else if (input.prompt) preview = String(input.prompt).substring(0, 80);
    else if (input.skill) preview = String(input.skill);
  }
  if (preview.length > 100) preview = preview.substring(0, 100) + "…";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        background: "var(--sna-surface)",
        border: "1px solid var(--sna-surface-border)",
        borderRadius: "var(--sna-radius-lg)",
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--sna-text-muted)",
            fontFamily: "var(--sna-font-mono)",
          }}
        >
          {toolName}
        </div>
        {preview && (
          <div
            style={{
              fontSize: 11,
              color: "var(--sna-text-faint)",
              fontFamily: "var(--sna-font-mono)",
              marginTop: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}
