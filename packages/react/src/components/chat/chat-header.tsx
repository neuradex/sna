"use client";

import { useState, useRef, useEffect } from "react";

interface SessionUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  contextWindow: number;
  lastTurnContextTokens: number;
  lastTurnSystemTokens: number;
  lastTurnConvTokens: number;
  model: string;
}

interface SessionTab {
  id: string;
  label: string;
  hasNewActivity: boolean;
}

interface ChatHeaderProps {
  onClose: () => void;
  onClear: () => void;
  isRunning: boolean;
  sessionUsage: SessionUsage;
  onModelChange: (model: string) => void;
  sessions?: SessionTab[];
  activeSessionId?: string;
  onSessionChange?: (id: string) => void;
  onSessionClose?: (id: string) => void;
}

const MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6", tier: "max" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "fast" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", tier: "instant" },
];

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ModelDropdown({
  currentModel,
  onChange,
}: {
  currentModel: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const current = MODELS.find((m) => currentModel.includes(m.id));
  const label = current?.label ?? currentModel.split("[")[0].replace("claude-", "") ?? "Model";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: "var(--sna-radius-md)",
          background: "var(--sna-surface)",
          border: "1px solid var(--sna-surface-border)",
          color: "var(--sna-text-muted)",
          fontSize: 11,
          fontFamily: "var(--sna-font-mono)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <svg width={8} height={8} viewBox="0 0 8 8" style={{ opacity: 0.5 }}>
          <path d="M1 3L4 6L7 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 160,
            background: "var(--sna-chat-bg)",
            border: "1px solid var(--sna-surface-border)",
            borderRadius: "var(--sna-radius-md)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            zIndex: 100,
            padding: 4,
          }}
        >
          {MODELS.map((m) => {
            const active = currentModel.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: "var(--sna-radius-sm)",
                  background: active ? "var(--sna-accent-soft)" : "transparent",
                  border: "none",
                  color: active ? "var(--sna-text)" : "var(--sna-text-secondary)",
                  fontSize: 12,
                  fontFamily: "var(--sna-font-mono)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.target as HTMLElement).style.background = "var(--sna-surface-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.target as HTMLElement).style.background = "transparent";
                }}
              >
                <span>{m.label}</span>
                <span style={{ fontSize: 10, color: "var(--sna-text-faint)" }}>{m.tier}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ChatHeader({ onClose, onClear, isRunning, sessionUsage, onModelChange, sessions, activeSessionId, onSessionChange, onSessionClose }: ChatHeaderProps) {
  const { totalInputTokens, totalOutputTokens, totalCost, contextWindow, lastTurnContextTokens, lastTurnSystemTokens, lastTurnConvTokens, model } = sessionUsage;
  const totalTokens = totalInputTokens + totalOutputTokens;
  const ctxPercent = contextWindow > 0 ? Math.min((lastTurnContextTokens / contextWindow) * 100, 100) : 0;
  const sysPercent = contextWindow > 0 ? Math.min((lastTurnSystemTokens / contextWindow) * 100, 100) : 0;
  const convPercent = contextWindow > 0 ? Math.min((lastTurnConvTokens / contextWindow) * 100, 100) : 0;

  return (
    <div style={{ borderBottom: "1px solid var(--sna-chat-border)", flexShrink: 0 }}>
      {/* Top row: logo + model + actions */}
      <div
        style={{
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 24, height: 24,
              borderRadius: "var(--sna-radius-sm)",
              background: "var(--sna-accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={14} height={14}>
              <polygon
                points="332,56 192,272 284,272 178,460 340,232 248,232"
                fill="white" stroke="white" strokeWidth="8" strokeLinejoin="round"
              />
            </svg>
          </div>
          <ModelDropdown currentModel={model} onChange={onModelChange} />
          {isRunning && (
            <span
              style={{
                width: 8, height: 8,
                borderRadius: "var(--sna-radius-full)",
                background: "var(--sna-success)",
                animation: "sna-pulse 2s ease-in-out infinite",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={onClear}
            style={{
              color: "var(--sna-text-icon)", background: "none",
              border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center",
            }}
            aria-label="Clear chat" title="Clear chat"
          >
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z"
                stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            onClick={onClose}
            style={{
              color: "var(--sna-text-icon)", background: "none",
              border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center",
            }}
            aria-label="Close chat"
          >
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session tabs */}
      {sessions && sessions.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 0,
            padding: "0 12px",
            borderBottom: "1px solid var(--sna-surface-border)",
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {sessions.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                onClick={() => onSessionChange?.(s.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  fontSize: 11,
                  fontFamily: "var(--sna-font-mono)",
                  color: active ? "var(--sna-text)" : "var(--sna-text-muted)",
                  background: "none",
                  border: "none",
                  borderBottom: active ? "2px solid var(--sna-accent)" : "2px solid transparent",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {s.id === "default" ? "Chat" : s.label}
                {s.hasNewActivity && !active && (
                  <span
                    style={{
                      width: 6, height: 6,
                      borderRadius: "var(--sna-radius-full)",
                      background: "var(--sna-accent)",
                      flexShrink: 0,
                    }}
                  />
                )}
                {s.id !== "default" && (
                  <span
                    onClick={(e) => { e.stopPropagation(); onSessionClose?.(s.id); }}
                    style={{
                      fontSize: 10,
                      color: "var(--sna-text-faint)",
                      cursor: "pointer",
                      marginLeft: 2,
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Bottom row: context window bar + usage stats */}
      {lastTurnContextTokens > 0 && (
        <div style={{ padding: "0 16px 8px" }}>
          {/* Segmented context bar: system (dim) + conversation (accent) */}
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: "var(--sna-surface)",
              overflow: "hidden",
              marginBottom: 6,
              display: "flex",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${sysPercent}%`,
                background: "rgba(255,255,255,0.10)",
                transition: "width 0.3s ease",
              }}
              title={`System: ${fmtTokens(lastTurnSystemTokens)} (tools, prompts, project files)`}
            />
            <div
              style={{
                height: "100%",
                width: `${convPercent}%`,
                background: "var(--sna-accent)",
                transition: "width 0.3s ease",
              }}
              title={`Conversation: ${fmtTokens(lastTurnConvTokens)}`}
            />
          </div>
          {/* Stats */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 10,
              fontFamily: "var(--sna-font-mono)",
              color: "var(--sna-text-faint)",
            }}
          >
            <span
              style={{ display: "flex", alignItems: "center", gap: 4 }}
              title="System overhead: tools, prompts, project files"
            >
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" }} />
              sys {fmtTokens(lastTurnSystemTokens)}
            </span>
            <span
              style={{ display: "flex", alignItems: "center", gap: 4 }}
              title="Conversation tokens (your messages + responses)"
            >
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "var(--sna-accent)" }} />
              conv {fmtTokens(lastTurnConvTokens)}
            </span>
            {contextWindow > 0 && (
              <span title={`${fmtTokens(lastTurnContextTokens)} / ${fmtTokens(contextWindow)}`}>
                {ctxPercent.toFixed(0)}%
              </span>
            )}
            <span title="Session cost" style={{ marginLeft: "auto" }}>
              ${totalCost.toFixed(4)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
