"use client";

import type { ChatMessage } from "../../stores/chat-store.js";
import { ToolUseCard } from "./tool-use-card.js";
import { SkillCard } from "./skill-card.js";

interface MessageBubbleProps {
  message: ChatMessage;
  onPermissionApprove?: () => void;
  onPermissionDeny?: () => void;
}

const bubbleBase: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 14,
  lineHeight: 1.5,
  maxWidth: "85%",
  wordBreak: "break-word",
};

export function MessageBubble({ message, onPermissionApprove, onPermissionDeny }: MessageBubbleProps) {
  switch (message.role) {
    case "user":
      return (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              ...bubbleBase,
              background: "var(--sna-accent-soft)",
              border: "1px solid var(--sna-accent-soft-border)",
              borderRadius: "var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-sm) var(--sna-radius-xl)",
              color: "var(--sna-text)",
            }}
          >
            {message.content}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div
            style={{
              ...bubbleBase,
              background: "var(--sna-surface)",
              border: "1px solid var(--sna-surface-border)",
              borderRadius: "var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-sm)",
              color: "var(--sna-text-secondary)",
            }}
          >
            {message.content}
          </div>
        </div>
      );

    case "status":
      return (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: "var(--sna-radius-full)",
              background: "var(--sna-surface)",
              border: "1px solid var(--sna-surface-border)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "var(--sna-radius-full)",
                background: "var(--sna-success)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                color: "var(--sna-text-muted)",
                fontSize: 12,
                fontFamily: "var(--sna-font-mono)",
              }}
            >
              {message.content}
            </span>
          </div>
        </div>
      );

    case "permission":
      return (
        <div
          style={{
            border: "1px solid var(--sna-warning-border)",
            background: "var(--sna-warning-bg)",
            borderRadius: "var(--sna-radius-lg)",
            padding: 16,
          }}
        >
          <p style={{ color: "var(--sna-warning-text)", fontSize: 14, margin: "0 0 12px 0" }}>
            {message.content}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onPermissionApprove}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--sna-radius-md)",
                background: "var(--sna-success-approve)",
                border: "none",
                color: "white",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Approve
            </button>
            <button
              onClick={onPermissionDeny}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--sna-radius-md)",
                background: "none",
                border: "1px solid var(--sna-surface-border)",
                color: "var(--sna-text-muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Deny
            </button>
          </div>
        </div>
      );

    case "error":
      return (
        <div
          style={{
            border: "1px solid var(--sna-error-border)",
            background: "var(--sna-error-bg)",
            borderRadius: "var(--sna-radius-lg)",
            padding: "10px 16px",
          }}
        >
          <p style={{ color: "var(--sna-error-text)", fontSize: 14, margin: 0 }}>
            {message.content}
          </p>
        </div>
      );

    case "tool":
      return <ToolUseCard message={message} />;

    case "skill":
      return <SkillCard message={message} />;
  }
}
