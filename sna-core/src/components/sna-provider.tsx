"use client";

import { memo, useEffect, useState } from "react";
import { ChatPanel } from "./chat/chat-panel.js";
import { useChatStore } from "../stores/chat-store.js";
import { useSkillEvents } from "../hooks/use-skill-events.js";
import { useResponsiveChat } from "../hooks/use-responsive-chat.js";
import { SnaContext, DEFAULT_SNA_URL } from "../core/sna-context.js";

// memo prevents re-mount when parent (children) re-renders
const StableChatPanel = memo(function StableChatPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  return <ChatPanel onClose={onClose} />;
});

/** Auto-opens chat panel when a permission request arrives.
 *  Disables its own SSE when chat is open — ChatPanel handles events then. */
function PermissionAutoOpen() {
  const setOpen = useChatStore((s) => s.setOpen);
  const chatOpen = useChatStore((s) => s.isOpen);
  useSkillEvents({
    enabled: !chatOpen,
    onNeedPermission: () => setOpen(true),
  });
  return null;
}

/**
 * Connecting overlay — shown while agent session is initializing.
 */
function ConnectingOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--sna-chat-bg, #0d0d14)",
        color: "#e0e0f0",
        fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 16 }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width="48"
            height="48"
          >
            <defs>
              <linearGradient id="sna-bolt-loading" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fafafa" />
                <stop offset="100%" stopColor="#c4b5fd" />
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="96" fill="#2d2548" />
            <polygon
              points="332,56 192,272 284,272 178,460 340,232 248,232"
              fill="url(#sna-bolt-loading)"
              stroke="url(#sna-bolt-loading)"
              strokeWidth="8"
              strokeLinejoin="round"
              paintOrder="stroke fill"
            />
          </svg>
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
          Starting SNA Agent...
        </div>
      </div>
    </div>
  );
}

/** Floating button to open chat when the panel is closed */
function FloatingChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--sna-accent, #7c3aed)",
        border: "none",
        boxShadow: "0 4px 24px var(--sna-accent-glow, rgba(124,58,237,0.4))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 50,
        transition: "background 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--sna-accent-hover, #8b5cf6)";
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.05)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--sna-accent, #7c3aed)";
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        width={20}
        height={20}
      >
        <polygon
          points="332,56 192,272 284,272 178,460 340,232 248,232"
          fill="white"
          stroke="white"
          strokeWidth="8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

interface SnaProviderProps {
  children: React.ReactNode;
  /**
   * Whether to show the chat panel open by default.
   * Only applies when there is no persisted state in localStorage.
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Permission mode for the spawned agent.
   * @default "acceptEdits"
   */
  dangerouslySkipPermissions?: boolean;
  /**
   * Override the SNA internal API server URL.
   * Defaults to http://localhost:3099 (started automatically by `sna up`).
   */
  snaUrl?: string;
}

/**
 * SnaProvider — right chat panel をアプリに埋め込むルートコンポーネント。
 *
 * Agent session (Claude Code via stdio spawn) を自動で開始し、
 * チャットパネルを通じてユーザーとエージェントを接続する。
 *
 * @example
 * import { SnaProvider } from "sna/components/sna-provider";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <SnaProvider defaultOpen>
 *       {children}
 *     </SnaProvider>
 *   );
 * }
 */
export function SnaProvider({
  children,
  defaultOpen = false,
  dangerouslySkipPermissions = false,
  snaUrl = DEFAULT_SNA_URL,
}: SnaProviderProps) {
  const [agentReady, setAgentReady] = useState(false);
  const chatOpen = useChatStore((s) => s.isOpen);
  const setChatOpen = useChatStore((s) => s.setOpen);
  const { mode } = useResponsiveChat();

  // 1. Start agent session on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    const permissionMode = dangerouslySkipPermissions
      ? "bypassPermissions"
      : "acceptEdits";

    fetch(`${snaUrl}/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude-code", permissionMode }),
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("[sna] agent/start response:", data);
        setAgentReady(true);
      })
      .catch((err) => {
        console.error("[sna] Failed to start agent:", err);
        setAgentReady(true);
      });
  }, [dangerouslySkipPermissions]);

  // 2. Auto-open chat on first mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("sna-chat-panel")) {
      useChatStore.getState().setOpen(defaultOpen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Keyboard shortcut: Cmd/Ctrl + . to toggle chat
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
    <SnaContext.Provider value={{ apiUrl: snaUrl }}>
      {!agentReady && <ConnectingOverlay />}

      {useFlex ? (
        <div style={{ display: "flex", height: "100dvh" }}>
          <div style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
            {children}
          </div>
          <StableChatPanel onClose={() => setChatOpen(false)} />
        </div>
      ) : (
        <>
          {children}
          {chatOpen && <StableChatPanel onClose={() => setChatOpen(false)} />}
        </>
      )}

      {!chatOpen && <FloatingChatButton onClick={() => setChatOpen(true)} />}
      <PermissionAutoOpen />
    </SnaContext.Provider>
  );
}
