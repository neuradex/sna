"use client";

import { useCallback } from "react";

interface ResizeHandleProps {
  onResize: (newWidth: number) => void;
  currentWidth: number;
}

export function ResizeHandle({ onResize, currentWidth }: ResizeHandleProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = currentWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        onResize(startWidth + delta);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onResize, currentWidth]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: 4,
        cursor: "col-resize",
        flexShrink: 0,
        transition: "background 0.15s",
        background: "var(--sna-resize-handle)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--sna-resize-handle-hover, rgba(139,92,246,0.3))";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--sna-resize-handle, transparent)";
      }}
    />
  );
}
