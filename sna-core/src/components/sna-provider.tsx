"use client";

import { memo, useEffect } from "react";
import { TerminalPanel } from "./terminal/terminal-panel.js";
import { useTerminalStore } from "../stores/terminal-store.js";
import { useSkillEvents } from "../hooks/use-skill-events.js";
import { wsManager } from "../lib/terminal/ws-manager.js";
import { TERMINAL_BAR_HEIGHT } from "../lib/terminal/constants.js";

interface TerminalPanelWrapperProps {
  dangerouslySkipPermissions: boolean;
}

// memo で囲むことで、親(children側)のre-renderがTerminalPanelに伝播しない
// → xterm インスタンスが破棄されない
const StableTerminalPanel = memo(function StableTerminalPanel({ dangerouslySkipPermissions }: TerminalPanelWrapperProps) {
  return <TerminalPanel dangerouslySkipPermissions={dangerouslySkipPermissions} />;
});

interface SnaProviderProps {
  children: React.ReactNode;
  /**
   * Whether to show the terminal drawer open by default.
   * Only applies when there is no persisted state in localStorage.
   * @default false
   */
  defaultOpen?: boolean;
  /**
   * Pass `--dangerously-skip-permissions` to Claude when spawning the terminal.
   * @default false
   */
  dangerouslySkipPermissions?: boolean;
}

/**
 * SnaProvider — bottom drawer terminal をアプリに埋め込むルートコンポーネント。
 *
 * layout.tsx のルートに置く。children がどれだけ re-render しても
 * TerminalPanel は再マウントされない。
 *
 * @example
 * // app/layout.tsx
 * import { SnaProvider } from "sna/components/sna-provider";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <SnaProvider defaultOpen dangerouslySkipPermissions>
 *           {children}
 *         </SnaProvider>
 *       </body>
 *     </html>
 *   );
 * }
 */
function PermissionAutoOpen() {
  const setOpen = useTerminalStore((s) => s.setOpen);
  useSkillEvents({
    onNeedPermission: () => setOpen(true),
  });
  return null;
}

/**
 * Connecting overlay — shown while WebSocket connection to Claude Code is being established.
 * Blocks the app UI until the terminal is ready, since Claude Code IS the runtime.
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
        backgroundColor: "#0d0d14",
        color: "#e0e0f0",
        fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 16 }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="48" height="48">
            <defs>
              <linearGradient id="sna-bolt-loading" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fafafa"/>
                <stop offset="100%" stopColor="#c4b5fd"/>
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="96" fill="#2d2548"/>
            <polygon points="332,56 192,272 284,272 178,460 340,232 248,232" fill="url(#sna-bolt-loading)" stroke="url(#sna-bolt-loading)" strokeWidth="8" strokeLinejoin="round" paintOrder="stroke fill"/>
          </svg>
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
          Connecting to Claude Code...
        </div>
      </div>
    </div>
  );
}

export function SnaProvider({
  children,
  defaultOpen = false,
  dangerouslySkipPermissions = false,
}: SnaProviderProps) {
  const connected = useTerminalStore((s) => s.connected);

  // 1. Auto-connect WebSocket immediately on mount (independent of drawer state).
  //    This ensures the PTY/Claude process starts before anything else.
  useEffect(() => {
    if (typeof window === "undefined") return;

    wsManager.connect({ dangerouslySkipPermissions });

    // Subscribe to sync connection state to the store even before Terminal mounts.
    // Terminal component will add its own subscriber later for xterm I/O.
    const unsub = wsManager.subscribe({
      onOpen: () => {
        useTerminalStore.getState().setConnected(true);
        useTerminalStore.getState().setIsConnecting(false);
      },
      onClose: () => {
        useTerminalStore.getState().setConnected(false);
      },
      onConnecting: () => {
        useTerminalStore.getState().setIsConnecting(true);
      },
    });

    return unsub;
  }, [dangerouslySkipPermissions]);

  // 2. CSS variable injection + auto-open drawer
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.style.setProperty("--sna-bar-height", `${TERMINAL_BAR_HEIGHT}px`);
    // Always open drawer on mount — SNA apps need the terminal visible
    if (!localStorage.getItem("terminal-panel")) {
      useTerminalStore.getState().setOpen(defaultOpen);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Block app UI until Claude Code is connected */}
      {!connected && <ConnectingOverlay />}
      {children}
      <PermissionAutoOpen />
      <StableTerminalPanel dangerouslySkipPermissions={dangerouslySkipPermissions} />
    </>
  );
}
