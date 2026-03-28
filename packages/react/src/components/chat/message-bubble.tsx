"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../stores/chat-store.js";
import { MarkdownContent } from "./markdown-content.js";
import { ThinkingCard } from "./thinking-card.js";
import { ToolUseCard } from "./tool-use-card.js";
import { SkillCard } from "./skill-card.js";

interface MessageBubbleProps {
  message: ChatMessage;
  isLast?: boolean;
}

const bubbleBase: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 14,
  lineHeight: 1.5,
  maxWidth: "85%",
  wordBreak: "break-word",
};

/** Typewriter effect for assistant messages */
function AssistantBubble({ message, isLast = false }: { message: ChatMessage; isLast?: boolean }) {
  const animate = !!message.meta?.animate;
  const text = message.content;
  const costLabel = (message.meta?.costLabel as string) ?? "";
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : Infinity);
  const [done, setDone] = useState(!animate);
  const wordsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!animate) { setDone(true); return; }
    const words = text.split(/(\s+)/);
    wordsRef.current = words;
    const total = words.length;
    const speed = total > 400 ? 5 : total > 200 ? 10 : total > 80 ? 18 : 25;
    let i = 0;

    const timer = setInterval(() => {
      i += 2;
      if (i >= total) {
        i = total;
        clearInterval(timer);
        setDone(true);
      }
      setVisibleCount(i);
    }, speed);

    return () => clearInterval(timer);
  }, [text, animate]);

  const visibleText = done ? text : wordsRef.current.slice(0, visibleCount).join("");

  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }} className="sna-msg-bubble">
      <div
        style={{
          ...bubbleBase,
          padding: "4px 0",
          background: "none",
          color: "var(--sna-text-secondary)",
          cursor: done ? undefined : "pointer",
          maxWidth: "100%",
        }}
        onClick={() => {
          if (!done) { setVisibleCount(Infinity); setDone(true); }
        }}
        title={done ? undefined : "Click to skip animation"}
      >
        <MarkdownContent text={visibleText} />
        {!done && (
          <span
            style={{
              display: "inline-block",
              width: 2,
              height: "1em",
              background: "var(--sna-accent)",
              marginLeft: 2,
              verticalAlign: "text-bottom",
              animation: "sna-pulse 1s infinite",
            }}
          />
        )}
        {done && costLabel && isLast && (
          <div
            style={{
              marginTop: 6,
              paddingTop: 4,
              borderTop: "1px solid rgba(255,255,255,0.04)",
              fontSize: 10,
              fontFamily: "var(--sna-font-mono)",
              color: "var(--sna-text-faint)",
              textAlign: "left",
            }}
          >
            {costLabel}
          </div>
        )}
        {done && costLabel && !isLast && (
          <span
            style={{
              display: "inline-block",
              marginLeft: 6,
              position: "relative",
              verticalAlign: "middle",
              cursor: "default",
            }}
            className="sna-cost-hint"
          >
            <svg width={12} height={12} viewBox="0 0 16 16" style={{ opacity: 0.25, verticalAlign: "middle" }}>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M8 7v4M8 5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="sna-cost-tooltip">{costLabel}</span>
          </span>
        )}
      </div>
    </div>
  );
}

const sIco = { stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

function IconCheck() {
  return <svg width={12} height={12} viewBox="0 0 24 24" {...sIco}><path d="M5 12l5 5L20 7" /></svg>;
}
function IconX() {
  return <svg width={12} height={12} viewBox="0 0 24 24" {...sIco}><path d="M18 6L6 18M6 6l12 12" /></svg>;
}
function IconAlertTriangle() {
  return <svg width={14} height={14} viewBox="0 0 24 24" {...sIco}><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>;
}

function ToolResultCard({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isError = !!message.meta?.isError;
  const content = message.content;
  const isLong = content.length > 120;
  const display = expanded || !isLong ? content : content.slice(0, 120) + "...";

  return (
    <div
      onClick={() => isLong && setExpanded(!expanded)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 5,
        padding: "1px 0 1px 24px",
        cursor: isLong ? "pointer" : undefined,
      }}
    >
      <span style={{ color: isError ? "var(--sna-error-text)" : "var(--sna-text-faint)", flexShrink: 0, marginTop: 1, display: "flex", opacity: 0.7 }}>
        {isError ? <IconX /> : <IconCheck />}
      </span>
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--sna-font-mono)",
          color: isError ? "var(--sna-error-text)" : "var(--sna-text-faint)",
          whiteSpace: "pre-wrap",
          lineHeight: 1.4,
          wordBreak: "break-all",
          minWidth: 0,
          opacity: 0.7,
        }}
      >
        {display}
      </div>
    </div>
  );
}

export function MessageBubble({ message, isLast = false }: MessageBubbleProps) {
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
      return <AssistantBubble message={message} isLast={isLast} />;

    case "thinking":
      return <ThinkingCard message={message} />;

    case "tool":
      return <ToolUseCard message={message} />;

    case "tool_result":
      return <ToolResultCard message={message} />;

    case "status":
      return (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <span
            style={{
              color: "var(--sna-text-faint)",
              fontSize: 10,
              fontFamily: "var(--sna-font-mono)",
              padding: "2px 0",
            }}
          >
            {message.content}
          </span>
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
          <p style={{ color: "var(--sna-warning-text)", fontSize: 14, margin: 0 }}>
            {message.content}
          </p>
        </div>
      );

    case "error":
      return (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            background: "var(--sna-error-bg)",
            border: "1px solid var(--sna-error-border)",
            borderRadius: "var(--sna-radius-md)",
          }}
        >
          <span style={{ color: "var(--sna-error-text)", flexShrink: 0, marginTop: 1, display: "flex" }}>
            <IconAlertTriangle />
          </span>
          <span style={{ color: "var(--sna-error-text)", fontSize: 12, lineHeight: 1.5 }}>
            {message.content}
          </span>
        </div>
      );

    case "skill":
      return <SkillCard message={message} />;
  }
}
