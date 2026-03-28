"use client";

import React, { useState } from "react";
import type { ChatMessage } from "../../stores/chat-store.js";

/** Tabler-style SVG icons (24x24 viewBox, 1.5px stroke) */
const s = { stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

function IconFile() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><path d="M14 3v4a1 1 0 001 1h4"/><path d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z"/></svg>;
}
function IconPencil() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><path d="M4 20h4L18.5 9.5a1.5 1.5 0 00-4-4L4 16v4"/><path d="M13.5 6.5l4 4"/></svg>;
}
function IconTerminal() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><path d="M5 7l5 5-5 5"/><line x1="12" y1="19" x2="19" y2="19"/></svg>;
}
function IconSearch() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><circle cx="10" cy="10" r="7"/><path d="M21 21l-6-6"/></svg>;
}
function IconFolderSearch() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><path d="M11 19H4a2 2 0 01-2-2V5a2 2 0 012-2h4l3 3h7a2 2 0 012 2v2.5"/><circle cx="17" cy="17" r="3"/><path d="M20.5 20.5L22 22"/></svg>;
}
function IconGlobe() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10 15 15 0 014-10"/></svg>;
}
function IconBot() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="9" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>;
}
function IconBolt() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><path d="M13 3L4 14h7l-2 7 9-11h-7l2-7"/></svg>;
}
function IconTool() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94L6.73 20.2a2 2 0 11-2.93-2.93l6.73-6.73A6 6 0 016.3 2.73l3.77 3.77z"/></svg>;
}
function IconFileText() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...s}><path d="M14 3v4a1 1 0 001 1h4"/><path d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z"/><line x1="9" y1="9" x2="10" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>;
}

const TOOL_ICONS: Record<string, () => React.JSX.Element> = {
  Read: IconFile,
  Edit: IconPencil,
  Write: IconFileText,
  Bash: IconTerminal,
  Glob: IconFolderSearch,
  Grep: IconSearch,
  WebFetch: IconGlobe,
  WebSearch: IconGlobe,
  Agent: IconBot,
  Skill: IconBolt,
};

export function ToolUseCard({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = (message.meta?.toolName as string) ?? message.content;
  const input = message.meta?.input as Record<string, unknown> | undefined;
  const result = message.meta?.result as string | undefined;
  const isError = !!message.meta?.isError;
  const hasResult = result != null;
  const IconComponent = TOOL_ICONS[toolName] ?? IconTool;

  let preview = "";
  if (input) {
    if (input.command) preview = String(input.command);
    else if (input.file_path) preview = String(input.file_path);
    else if (input.pattern) preview = String(input.pattern);
    else if (input.query) preview = String(input.query);
    else if (input.prompt) preview = String(input.prompt).substring(0, 80);
    else if (input.skill) preview = String(input.skill);
  }
  if (preview.length > 100) preview = preview.substring(0, 100) + "...";

  const resultPreview = result && result.length > 120 ? result.slice(0, 120) + "..." : result;

  return (
    <div>
      {/* Tool call header — clickable if result exists */}
      <div
        onClick={() => hasResult && setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 0",
          cursor: hasResult ? "pointer" : undefined,
        }}
      >
        {hasResult && (
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
        <span style={{ color: isError ? "var(--sna-error-text)" : "var(--sna-text-faint)", flexShrink: 0, display: "flex" }}>
          <IconComponent />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: isError ? "var(--sna-error-text)" : "var(--sna-text-muted)",
            fontFamily: "var(--sna-font-mono)",
            flexShrink: 0,
          }}
        >
          {toolName}
        </span>
        {preview && (
          <span
            style={{
              fontSize: 10,
              color: isError ? "rgba(252,165,165,0.5)" : "var(--sna-text-faint)",
              fontFamily: "var(--sna-font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              opacity: 0.6,
            }}
          >
            {preview}
          </span>
        )}
        {/* Inline status indicator when collapsed */}
        {hasResult && !expanded && (
          <span style={{ color: isError ? "var(--sna-error-text)" : "var(--sna-success)", display: "flex", flexShrink: 0, opacity: 0.6, marginLeft: "auto" }}>
            {isError
              ? <svg width={10} height={10} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              : <svg width={10} height={10} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"><path d="M5 12l5 5L20 7"/></svg>
            }
          </span>
        )}
      </div>

      {/* Expandable result */}
      {expanded && result && (
        <div
          style={{
            padding: "2px 0 2px 24px",
            fontSize: 10,
            fontFamily: "var(--sna-font-mono)",
            color: isError ? "var(--sna-error-text)" : "var(--sna-text-faint)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.4,
            wordBreak: "break-all",
            opacity: 0.7,
          }}
        >
          {resultPreview}
        </div>
      )}
    </div>
  );
}
