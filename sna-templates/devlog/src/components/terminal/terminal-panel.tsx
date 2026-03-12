"use client";

import dynamic from "next/dynamic";
import { useRef, useCallback } from "react";
import { useTerminalStore } from "@/stores/terminal-store";
import { TERMINAL_MIN_WIDTH, TERMINAL_MAX_WIDTH_RATIO } from "@/lib/terminal/constants";

const Terminal = dynamic(
  () => import("./terminal").then((m) => m.Terminal),
  { ssr: false }
);

export function TerminalPanel() {
  const { width, connected, isOpen, setWidth, setOpen } = useTerminalStore();
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const onMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = startX - e.clientX;
        const max = window.innerWidth * TERMINAL_MAX_WIDTH_RATIO;
        setWidth(Math.min(max, Math.max(TERMINAL_MIN_WIDTH, startWidth + delta)));
      };
      const onUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, setWidth]
  );

  return (
    <>
      {/* Collapsed tab — always rendered so Terminal stays mounted */}
      {!isOpen && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center justify-center w-8 border-l border-white/8 bg-[#0d0d14] hover:bg-white/3 transition-colors shrink-0"
          title="Open Claude Code"
        >
          <span className="text-white/20 hover:text-violet-400 text-[10px] font-mono transition-colors" style={{ writingMode: "vertical-rl" }}>
            Claude Code
          </span>
        </button>
      )}

      {/* Panel — hidden via CSS when closed, never unmounted */}
      <div
        className="relative flex flex-col border-l border-white/8 shrink-0 bg-[#0d0d14]"
        style={{ width: isOpen ? width : 0, overflow: "hidden", display: isOpen ? "flex" : "none" }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-violet-500/40 transition-colors z-10"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/8">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
              <span className="text-violet-400 text-[9px] font-bold font-mono">C</span>
            </div>
            <span className="text-xs font-medium text-white/50">Claude Code</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/20"}`}
              title={connected ? "connected" : "connecting..."}
            />
            <button
              onClick={() => setOpen(false)}
              className="text-white/20 hover:text-white/60 transition-colors text-sm leading-none px-1"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Terminal — always mounted */}
        <div className="flex-1 overflow-hidden">
          <Terminal />
        </div>
      </div>
    </>
  );
}
