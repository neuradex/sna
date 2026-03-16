"use client";

import { lazy, Suspense, useRef, useCallback, useEffect } from "react";
import { useTerminalStore } from "../../stores/terminal-store.js";
import { wsManager } from "../../lib/terminal/ws-manager.js";
import {
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MAX_HEIGHT_RATIO,
  TERMINAL_SNAP_THRESHOLD,
  TERMINAL_BAR_HEIGHT,
} from "../../lib/terminal/constants.js";
import { SettingsMenu } from "./settings-menu.js";

const Terminal = lazy(() => import("./terminal.js").then((m) => ({ default: m.Terminal })));

interface TerminalPanelProps {
  dangerouslySkipPermissions?: boolean;
}

export function TerminalPanel({ dangerouslySkipPermissions = false }: TerminalPanelProps) {
  const { height, connected, isOpen, isConnecting, setHeight, setOpen } = useTerminalStore();
  const isDragging = useRef(false);
  // Terminal は常にマウントし、接続を維持する（Claude Code がランタイムのため）。
  // drawer が閉じているときは visibility:hidden + 最小サイズでレンダリングし、
  // xterm.js の 0×0 問題を回避する。
  const terminalMounted = true;
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = isOpen ? height : 0;

      const onMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = dragStartY.current - e.clientY;
        const newHeight = dragStartHeight.current + delta;

        if (newHeight < TERMINAL_SNAP_THRESHOLD) {
          setOpen(false);
        } else {
          const max = window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO;
          setHeight(Math.max(TERMINAL_MIN_HEIGHT, Math.min(max, newHeight)));
          setOpen(true);
        }
      };

      const onUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height, isOpen, setHeight, setOpen]
  );

  // isOpen になったらターミナルにフォーカス＆リサイズ
  useEffect(() => {
    if (!isOpen) return;
    // display:none → flex の切り替え後に fit/focus させるため少し遅延
    const t = setTimeout(() => {
      useTerminalStore.getState().fitFn?.();
      useTerminalStore.getState().focusFn?.();
    }, 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Option + ` (Alt + Backquote) でトグル
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "Backquote") {
        e.preventDefault();
        setOpen(!useTerminalStore.getState().isOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);

  return (
    <>
      {/* Backdrop — dims the app and closes the drawer on click */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          backgroundColor: "rgba(0,0,0,0.8)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        onClick={() => setOpen(false)}
      />

      {/* Bottom drawer */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col"
        style={{
          backgroundColor: "#0d0d14",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          height: isOpen ? height + TERMINAL_BAR_HEIGHT : TERMINAL_BAR_HEIGHT,
          transition: isDragging.current ? "none" : "height 0.2s ease",
        }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={handleDragStart}
          className="absolute top-0 left-0 right-0 z-10"
          style={{ height: 4, cursor: "row-resize" }}
        />

        {/* Bar — always visible, click to toggle */}
        <div
          className="relative z-10 flex items-center justify-between shrink-0 cursor-pointer select-none"
          style={{
            height: TERMINAL_BAR_HEIGHT,
            backgroundColor: "#1a1a2e",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            padding: "0 16px",
          }}
          onClick={() => setOpen(!isOpen)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16" style={{ flexShrink: 0 }}>
              <defs>
                <linearGradient id="sna-bolt-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fafafa"/>
                  <stop offset="100%" stopColor="#c4b5fd"/>
                </linearGradient>
              </defs>
              <rect width="512" height="512" rx="96" fill="#2d2548"/>
              <polygon points="332,56 192,272 284,272 178,460 340,232 248,232" fill="url(#sna-bolt-grad)" stroke="url(#sna-bolt-grad)" strokeWidth="8" strokeLinejoin="round" paintOrder="stroke fill"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: "#fff" }}>SNA Console</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: 8 }}>Claude Code</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Connection status */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                backgroundColor: connected ? "#34d399" : isConnecting ? "#facc15" : "rgba(255,255,255,0.3)",
                display: "inline-block",
              }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
                {connected ? "ready" : isConnecting ? "connecting…" : "offline"}
              </span>
            </div>

            {/* Restart */}
            <button
              title="Restart terminal"
              onClick={(e) => {
                e.stopPropagation();
                wsManager.restart();
              }}
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.15)",
                cursor: "pointer",
                padding: "3px 8px",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                gap: 4,
                color: "rgba(255,255,255,0.7)",
                fontSize: 11,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                e.currentTarget.style.color = "rgba(255,255,255,0.7)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              <span>Restart</span>
            </button>

            {/* Settings */}
            <SettingsMenu />

            {/* Chevron */}
            <span style={{
              fontSize: 10, color: "rgba(255,255,255,0.7)",
              display: "inline-block",
              transform: isOpen ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.2s",
            }}>▼</span>
          </div>
        </div>

        {/* Terminal content — 常にマウント（Claude Code セッション保持）
            閉じているときは visibility:hidden + 最小サイズでレンダリング。
            display:none だと xterm.js が 0×0 になるため使わない。 */}
        <div
          className="flex-1 overflow-hidden"
          style={{
            display: "flex",
            visibility: isOpen ? "visible" : "hidden",
            height: isOpen ? undefined : 1,
            overflow: isOpen ? undefined : "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {terminalMounted && (
            <Suspense fallback={null}>
              <Terminal dangerouslySkipPermissions={dangerouslySkipPermissions} />
            </Suspense>
          )}
        </div>
      </div>
    </>
  );
}
