"use client";

import type { ChatMessage } from "../../stores/chat-store.js";

export function SkillCard({ message }: { message: ChatMessage }) {
  const skillName = message.skillName ?? "skill";
  const status = (message.meta?.status as string) ?? "running";
  const milestones = (message.meta?.milestones as string[]) ?? [];
  const isComplete = status === "complete" || status === "success";
  const isError = status === "error" || status === "failed";

  return (
    <div
      style={{
        padding: "12px 14px",
        background: isError
          ? "var(--sna-error-bg)"
          : isComplete
          ? "var(--sna-surface)"
          : "var(--sna-accent-soft)",
        border: `1px solid ${
          isError
            ? "var(--sna-error-border)"
            : isComplete
            ? "var(--sna-surface-border)"
            : "var(--sna-accent-soft-border)"
        }`,
        borderRadius: "var(--sna-radius-lg)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: milestones.length ? 8 : 0 }}>
        <span style={{ fontSize: 14 }}>⚡</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--sna-font-mono)",
            color: isError ? "var(--sna-error-text)" : "var(--sna-accent-hover)",
          }}
        >
          {skillName}
        </span>
        {!isComplete && !isError && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "var(--sna-radius-full)",
              background: "var(--sna-accent-hover)",
              animation: "sna-pulse 2s ease-in-out infinite",
            }}
          />
        )}
        {isComplete && (
          <span style={{ color: "var(--sna-success)", fontSize: 12, fontWeight: 600 }}>✓</span>
        )}
        {isError && (
          <span style={{ color: "var(--sna-error-text)", fontSize: 12, fontWeight: 600 }}>✗</span>
        )}
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 22 }}>
          {milestones.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--sna-text-muted)",
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "var(--sna-radius-full)",
                  background: "var(--sna-success)",
                  flexShrink: 0,
                }}
              />
              {m}
            </div>
          ))}
        </div>
      )}

      {/* Latest message */}
      {message.content && message.content !== skillName && (
        <div
          style={{
            fontSize: 12,
            color: "var(--sna-text-muted)",
            marginTop: 6,
            paddingLeft: 22,
          }}
        >
          {message.content}
        </div>
      )}
    </div>
  );
}
