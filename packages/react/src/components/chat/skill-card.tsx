"use client";

import { useState } from "react";
import type { ChatMessage } from "../../stores/chat-store.js";

const sIco = { stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

function IconBolt() {
  return <svg width={14} height={14} viewBox="0 0 24 24" {...sIco}><path d="M13 3L4 14h7l-2 7 9-11h-7l2-7"/></svg>;
}

export function SkillCard({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const skillName = message.skillName ?? "skill";
  const status = (message.meta?.status as string) ?? "running";
  const milestones = (message.meta?.milestones as string[]) ?? [];
  const isComplete = status === "complete" || status === "success";
  const isError = status === "error" || status === "failed";
  const isRunning = !isComplete && !isError;
  const hasMilestones = milestones.length > 0;

  return (
    <div>
      {/* Header */}
      <div
        onClick={() => hasMilestones && setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 0",
          cursor: hasMilestones ? "pointer" : undefined,
        }}
      >
        {hasMilestones && (
          <svg
            width={8} height={8} viewBox="0 0 8 8"
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
              flexShrink: 0,
              opacity: 0.4,
            }}
          >
            <path d="M2 1L6 4L2 7" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          </svg>
        )}
        <span style={{ color: isError ? "var(--sna-error-text)" : "var(--sna-accent)", flexShrink: 0, display: "flex" }}>
          <IconBolt />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            fontFamily: "var(--sna-font-mono)",
            color: isError ? "var(--sna-error-text)" : "var(--sna-accent-hover)",
          }}
        >
          {skillName}
        </span>
        {isRunning && (
          <span
            style={{
              width: 6, height: 6,
              borderRadius: "50%",
              background: "var(--sna-accent-hover)",
              animation: "sna-pulse 2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        )}
        {isComplete && (
          <span style={{ color: "var(--sna-success)", display: "flex", flexShrink: 0, opacity: 0.6 }}>
            <svg width={10} height={10} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"><path d="M5 12l5 5L20 7"/></svg>
          </span>
        )}
        {isError && (
          <span style={{ color: "var(--sna-error-text)", display: "flex", flexShrink: 0, opacity: 0.6 }}>
            <svg width={10} height={10} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </span>
        )}
      </div>

      {/* Expanded milestones */}
      {expanded && hasMilestones && (
        <div style={{ padding: "2px 0 2px 24px" }}>
          {milestones.map((m, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                fontFamily: "var(--sna-font-mono)",
                color: "var(--sna-text-faint)",
                lineHeight: 1.6,
                opacity: 0.7,
              }}
            >
              {m}
            </div>
          ))}
        </div>
      )}

      {/* Latest message (when not expanded) */}
      {!expanded && message.content && message.content !== skillName && (
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--sna-font-mono)",
            color: "var(--sna-text-faint)",
            padding: "1px 0 1px 24px",
            opacity: 0.7,
          }}
        >
          {message.content}
        </div>
      )}
    </div>
  );
}
