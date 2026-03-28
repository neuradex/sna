"use client";

import type { SkillEvent } from "../../hooks/use-skill-events.js";

interface SkillExecutionCardProps {
  skillName: string;
  events: SkillEvent[];
}

export function SkillExecutionCard({ skillName, events }: SkillExecutionCardProps) {
  const latestMilestone = events.filter((e) => e.type === "milestone").at(-1);
  const isComplete = events.some(
    (e) => e.type === "complete" || e.type === "success"
  );

  return (
    <div
      style={{
        border: "1px solid var(--sna-accent-soft-border)",
        background: "var(--sna-accent-soft)",
        borderRadius: "var(--sna-radius-lg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--sna-font-mono)",
            fontSize: 12,
            color: "var(--sna-accent-hover)",
          }}
        >
          {skillName}
        </span>
        {!isComplete && (
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
          <span style={{ color: "var(--sna-success)", fontSize: 12 }}>&#10003;</span>
        )}
      </div>
      {latestMilestone && (
        <p style={{ color: "var(--sna-text-muted)", fontSize: 12, margin: 0 }}>
          {latestMilestone.message}
        </p>
      )}
      <span
        style={{
          color: "var(--sna-text-faint)",
          fontSize: 10,
          fontFamily: "var(--sna-font-mono)",
        }}
      >
        {events.length} events
      </span>
    </div>
  );
}
