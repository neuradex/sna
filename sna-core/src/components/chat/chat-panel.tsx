"use client";

import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../stores/chat-store.js";
import { useSkillEvents, type SkillEvent } from "../../hooks/use-skill-events.js";
import { useAgent, type AgentEvent } from "../../hooks/use-agent.js";
import { ChatHeader } from "./chat-header.js";
import { MessageBubble } from "./message-bubble.js";
import { ChatInput } from "./chat-input.js";
import { TypingIndicator } from "./typing-indicator.js";
import { ResizeHandle } from "./resize-handle.js";
import { useResponsiveChat, type ChatMode } from "../../hooks/use-responsive-chat.js";

interface ChatPanelProps {
  onClose: () => void;
}

/** Inject keyframe animations + CSS variable defaults once */
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("sna-chat-styles")) return;
  const style = document.createElement("style");
  style.id = "sna-chat-styles";
  style.textContent = `
    :root {
      --sna-chat-bg: #0d0d14;
      --sna-chat-border: rgba(255,255,255,0.08);
      --sna-surface: rgba(255,255,255,0.03);
      --sna-surface-border: rgba(255,255,255,0.08);
      --sna-surface-hover: rgba(255,255,255,0.05);
      --sna-overlay: rgba(0,0,0,0.5);
      --sna-accent: #7c3aed;
      --sna-accent-hover: #8b5cf6;
      --sna-accent-soft: rgba(139,92,246,0.12);
      --sna-accent-soft-border: rgba(139,92,246,0.20);
      --sna-accent-muted: rgba(139,92,246,0.6);
      --sna-accent-glow: rgba(124,58,237,0.4);
      --sna-text: rgba(255,255,255,0.8);
      --sna-text-secondary: rgba(255,255,255,0.7);
      --sna-text-muted: rgba(255,255,255,0.4);
      --sna-text-faint: rgba(255,255,255,0.15);
      --sna-text-icon: rgba(255,255,255,0.3);
      --sna-success: #34d399;
      --sna-success-approve: #059669;
      --sna-success-approve-hover: #047857;
      --sna-warning-bg: rgba(251,191,36,0.06);
      --sna-warning-border: rgba(251,191,36,0.30);
      --sna-warning-text: rgba(252,211,77,0.9);
      --sna-error-bg: rgba(248,113,113,0.06);
      --sna-error-border: rgba(248,113,113,0.30);
      --sna-error-text: rgba(252,165,165,0.9);
      --sna-disconnect: #fbbf24;
      --sna-font-mono: 'SF Mono', 'Fira Code', ui-monospace, monospace;
      --sna-font-sans: inherit;
      --sna-radius-sm: 6px;
      --sna-radius-md: 8px;
      --sna-radius-lg: 12px;
      --sna-radius-xl: 16px;
      --sna-radius-full: 9999px;
      --sna-resize-handle: transparent;
      --sna-resize-handle-hover: rgba(139,92,246,0.3);
    }
    @keyframes sna-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes sna-bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    @keyframes sna-slide-in {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
}

const TERMINAL_EVENT_TYPES = new Set(["success", "failed", "complete", "error"]);

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const addMessage = useChatStore((s) => s.addMessage);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const markEventProcessed = useChatStore((s) => s.markEventProcessed);
  const width = useChatStore((s) => s.width);
  const setWidth = useChatStore((s) => s.setWidth);
  const { mode } = useResponsiveChat();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [thinking, setThinking] = useState(false);
  const [sessionUsage, setSessionUsage] = useState({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    contextWindow: 0,
    lastTurnContextTokens: 0,
    lastTurnSystemTokens: 0,
    lastTurnConvTokens: 0,
    model: "claude-sonnet-4-6",
  });

  useEffect(() => injectStyles(), []);

  // Subscribe to agent events (from stdio spawn)
  const agent = useAgent({
    onEvent: (e) => {
      if (e.type === "tool_use") {
        const toolName = (e.data?.toolName as string) ?? e.message ?? "tool";
        addMessage({
          role: "tool",
          content: toolName,
          meta: { toolName, input: e.data?.input },
        });
      }
    },
    onThinking: (e) => {
      // Keep thinking=true — TypingIndicator stays until text arrives
      addMessage({
        role: "thinking",
        content: e.message ?? "",
        meta: { done: true },
      });
    },
    onAssistant: (e) => {
      setThinking(false);
      addMessage({ role: "assistant", content: e.message ?? "", meta: { animate: true } });
    },
    onToolResult: (e) => {
      // Attach result to the last tool message instead of creating a new one
      const msgs = useChatStore.getState().messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "tool" && !msgs[i].meta?.result) {
          const updated = [...msgs];
          updated[i] = {
            ...updated[i],
            meta: {
              ...updated[i].meta,
              result: e.message ?? "",
              isError: !!e.data?.isError,
            },
          };
          useChatStore.setState({ messages: updated });
          return;
        }
      }
    },
    onInit: (e) => {
      const model = (e.data?.model as string) ?? "";
      if (model) setSessionUsage((prev) => ({ ...prev, model }));
    },
    onComplete: (e) => {
      setThinking(false);
      const d = e.data ?? {};
      const duration = d.durationMs as number | undefined;
      const cost = d.costUsd as number | undefined;
      const inTok = (d.inputTokens as number) ?? 0;
      const outTok = (d.outputTokens as number) ?? 0;
      const cacheRead = (d.cacheReadTokens as number) ?? 0;
      const cacheWrite = (d.cacheWriteTokens as number) ?? 0;
      const ctxWindow = (d.contextWindow as number) ?? 0;
      const model = (d.model as string) ?? "";

      // Accumulate session usage
      const systemTok = cacheRead + cacheWrite;
      const convTok = inTok + outTok;
      setSessionUsage((prev) => ({
        totalInputTokens: prev.totalInputTokens + inTok,
        totalOutputTokens: prev.totalOutputTokens + outTok,
        totalCost: prev.totalCost + (cost ?? 0),
        contextWindow: ctxWindow || prev.contextWindow,
        lastTurnContextTokens: systemTok + convTok,
        lastTurnSystemTokens: systemTok,
        lastTurnConvTokens: convTok,
        model: model || prev.model,
      }));

      // Attach cost info to the last assistant message
      const msgs = useChatStore.getState().messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          const parts: string[] = [];
          if (duration != null) parts.push(`${(duration / 1000).toFixed(1)}s`);
          if (outTok > 0) parts.push(`${fmtTokens(outTok)} tokens`);
          if (cost != null) parts.push(`$${cost.toFixed(4)}`);
          // Update the message meta with cost info
          const updated = [...msgs];
          updated[i] = { ...updated[i], meta: { ...updated[i].meta, costLabel: parts.join(" · ") } };
          useChatStore.setState({ messages: updated });
          break;
        }
      }
    },
    onError: (e) => {
      setThinking(false);
      addMessage({ role: "error", content: e.message ?? "Unknown error" });
    },
  });

  // Subscribe to skill events (from SQLite → SSE)
  // Skill events accumulate milestones into a single "skill" card (updated in-place)
  const skillMilestonesRef = useRef<Record<string, string[]>>({});

  const { events } = useSkillEvents({
    onCalled: (e) => {
      if (!markEventProcessed(e.id)) return;
      skillMilestonesRef.current[e.skill] = [];
      addMessage({
        role: "skill",
        content: "",
        skillName: e.skill,
        meta: { status: "running", milestones: [] },
      });
    },
    onMilestone: (e) => {
      if (!markEventProcessed(e.id)) return;
      const ms = skillMilestonesRef.current[e.skill] ?? [];
      ms.push(e.message);
      skillMilestonesRef.current[e.skill] = ms;
      addMessage({
        role: "skill",
        content: e.message,
        skillName: e.skill,
        meta: { status: "running", milestones: [...ms] },
      });
    },
    onProgress: (e) => {
      if (!markEventProcessed(e.id)) return;
      addMessage({ role: "status", content: e.message, skillName: e.skill });
    },
    onSuccess: (e) => {
      if (!markEventProcessed(e.id)) return;
      addMessage({
        role: "skill",
        content: e.message,
        skillName: e.skill,
        meta: { status: "complete", milestones: [...(skillMilestonesRef.current[e.skill] ?? [])] },
      });
    },
    onFailed: (e) => {
      if (!markEventProcessed(e.id)) return;
      addMessage({
        role: "skill",
        content: e.message,
        skillName: e.skill,
        meta: { status: "failed", milestones: [...(skillMilestonesRef.current[e.skill] ?? [])] },
      });
    },
    onNeedPermission: (e) => {
      if (!markEventProcessed(e.id)) return;
      addMessage({ role: "permission", content: e.message, skillName: e.skill });
    },
  });

  const anyRunning = events.length > 0 && (() => {
    const latestBySkill = events.reduce<Record<string, SkillEvent>>((acc, e) => {
      acc[e.skill] = e;
      return acc;
    }, {});
    return Object.values(latestBySkill).some((e) => !TERMINAL_EVENT_TYPES.has(e.type));
  })();

  // Auto-scroll on any content change (new messages, typewriter, tool results)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new MutationObserver(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const handleSend = async (text: string) => {
    addMessage({ role: "user", content: text });
    setThinking(true);
    try {
      const res = await agent.send(text);
      console.log("[ChatPanel:handleSend] send result:", res);
      if (res?.status === "error") {
        await agent.start(text);
      }
    } catch (err) {
      console.error("[ChatPanel:handleSend] error:", err);
      setThinking(false);
    }
  };

  const panelStyle = getPanelStyle(mode, width);

  return (
    <>
      {mode !== "side-by-side" && (
        <div
          onClick={onClose}
          style={{ position: "fixed", inset: 0, background: "var(--sna-overlay)", zIndex: 40 }}
        />
      )}

      {mode === "side-by-side" && (
        <ResizeHandle onResize={setWidth} currentWidth={width} />
      )}

      <aside
        style={{
          ...panelStyle,
          borderLeft: "1px solid var(--sna-chat-border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--sna-chat-bg)",
          fontFamily: "var(--sna-font-sans)",
          zIndex: 50,
          animation: "sna-slide-in 0.2s ease-out",
        }}
      >
        <ChatHeader
          onClose={onClose}
          onClear={async () => {
            clearMessages();
            setThinking(true);
            setSessionUsage({
              totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0,
              contextWindow: 0, lastTurnContextTokens: 0,
              lastTurnSystemTokens: 0, lastTurnConvTokens: 0, model: sessionUsage.model,
            });
            await agent.kill();
            await agent.start();
            setThinking(false);
          }}
          isRunning={thinking || (anyRunning ?? false)}
          sessionUsage={sessionUsage}
          onModelChange={(model) => {
            setSessionUsage((prev) => ({ ...prev, model }));
            // Restart agent with new model
            agent.kill();
            agent.start();
          }}
        />

        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 40, height: 40,
                  borderRadius: "var(--sna-radius-lg)",
                  background: "var(--sna-accent-soft)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={20} height={20}>
                  <polygon points="332,56 192,272 284,272 178,460 340,232 248,232"
                    fill="var(--sna-accent-muted)" stroke="var(--sna-accent-muted)"
                    strokeWidth="8" strokeLinejoin="round" />
                </svg>
              </div>
              <p style={{ color: "var(--sna-text-icon)", fontSize: 14, margin: 0 }}>
                Run a skill or ask a question
              </p>
              <p style={{ color: "var(--sna-text-faint)", fontSize: 12, marginTop: 4, fontFamily: "var(--sna-font-mono)" }}>
                Type /skill-name or ask in natural language
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {thinking && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        <ChatInput onSend={handleSend} disabled={false} />
      </aside>
    </>
  );
}

function getPanelStyle(mode: ChatMode, width: number): React.CSSProperties {
  switch (mode) {
    case "fullscreen":
      return { position: "fixed", inset: 0, width: "100vw", height: "100dvh", zIndex: 50 };
    case "overlay":
      return { position: "fixed", right: 0, top: 0, bottom: 0, width: Math.min(width, 420), zIndex: 50 };
    case "side-by-side":
      return { width, minWidth: 320, maxWidth: 520, flexShrink: 0 };
  }
}
