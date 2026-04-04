"use client";

import { memo, useEffect, useState } from "react";
import { ChatPanel } from "./chat/chat-panel.js";
import { useChatStore } from "../stores/chat-store.js";
import { useSkillEvents } from "../hooks/use-skill-events.js";
import { useResponsiveChat } from "../hooks/use-responsive-chat.js";
import { useSnaContext } from "../context.js";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

const StableChatPanel = memo(function StableChatPanel({
  onClose,
  sessionId = "default",
}: {
  onClose: () => void;
  sessionId?: string;
}) {
  return <ChatPanel onClose={onClose} sessionId={sessionId} />;
});

function PermissionAutoOpen() {
  const setOpen = useChatStore((s) => s.setOpen);
  const chatOpen = useChatStore((s) => s.isOpen);
  useSkillEvents({
    enabled: !chatOpen,
    onNeedPermission: () => setOpen(true),
  });
  return null;
}

function ConnectingOverlay() {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        backgroundColor: "var(--sna-chat-bg, #0d0d14)", color: "#e0e0f0",
        fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 16 }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="48" height="48">
            <defs>
              <linearGradient id="sna-bolt-loading" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fafafa" />
                <stop offset="100%" stopColor="#c4b5fd" />
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="96" fill="#2d2548" />
            <polygon
              points="332,56 192,272 284,272 178,460 340,232 248,232"
              fill="url(#sna-bolt-loading)" stroke="url(#sna-bolt-loading)"
              strokeWidth="8" strokeLinejoin="round" paintOrder="stroke fill"
            />
          </svg>
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>Starting SNA Agent...</div>
      </div>
    </div>
  );
}

function FloatingChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "fixed", bottom: 24, right: 24, width: 48, height: 48,
        borderRadius: "50%", background: "var(--sna-accent, #7c3aed)", border: "none",
        boxShadow: "0 4px 24px var(--sna-accent-glow, rgba(124,58,237,0.4))",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", zIndex: 50, transition: "background 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--sna-accent-hover, #8b5cf6)";
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.05)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--sna-accent, #7c3aed)";
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={20} height={20}>
        <polygon points="332,56 192,272 284,272 178,460 340,232 248,232" fill="white" stroke="white" strokeWidth="8" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

interface SnaChatUIProps {
  children: React.ReactNode;
  /** Open chat panel on first visit. @default false */
  defaultOpen?: boolean;
  /** Skip Claude permission prompts. @default false */
  dangerouslySkipPermissions?: boolean;
}

/**
 * SnaChatUI — built-in chat panel with agent auto-start.
 *
 * Requires @radix-ui/react-tooltip as a peer dependency.
 * Must be rendered inside <SnaProvider>.
 *
 * @example
 * import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
 * import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";
 *
 * <SnaProvider>
 *   <SnaChatUI>{children}</SnaChatUI>
 * </SnaProvider>
 */
export function SnaChatUI({
  children,
  defaultOpen = false,
  dangerouslySkipPermissions = false,
}: SnaChatUIProps) {
  const { apiUrl, sessionId } = useSnaContext();
  const [agentReady, setAgentReady] = useState(false);
  const chatOpen = useChatStore((s) => s.isOpen);
  const setChatOpen = useChatStore((s) => s.setOpen);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const { mode } = useResponsiveChat();

  // Auto-start agent
  useEffect(() => {
    if (typeof window === "undefined" || !apiUrl) return;
    const permissionMode = dangerouslySkipPermissions ? "bypassPermissions" : undefined;
    fetch(`${apiUrl}/agent/start?session=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude-code", permissionMode }),
    })
      .then((res) => res.json())
      .then(() => setAgentReady(true))
      .catch(() => setAgentReady(true));
  }, [apiUrl, dangerouslySkipPermissions, sessionId]);

  // Auto-open chat on first mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("sna-chat-panel")) {
      useChatStore.getState().setOpen(defaultOpen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + . to toggle chat
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        useChatStore.getState().toggle();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  const useFlex = chatOpen && mode === "side-by-side";

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      {!agentReady && <ConnectingOverlay />}

      {useFlex ? (
        <div style={{ display: "flex", height: "100dvh" }}>
          <div style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
            {children}
          </div>
          <StableChatPanel onClose={() => setChatOpen(false)} sessionId={activeSessionId} />
        </div>
      ) : (
        <>
          {children}
          {chatOpen && <StableChatPanel onClose={() => setChatOpen(false)} sessionId={activeSessionId} />}
        </>
      )}

      {!chatOpen && <FloatingChatButton onClick={() => setChatOpen(true)} />}
      <PermissionAutoOpen />
    </TooltipPrimitive.Provider>
  );
}
