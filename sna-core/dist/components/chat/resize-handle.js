"use client";
import { jsx } from "react/jsx-runtime";
import { useCallback } from "react";
function ResizeHandle({ onResize, currentWidth }) {
  const handleMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = currentWidth;
      const onMove = (ev) => {
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
  return /* @__PURE__ */ jsx(
    "div",
    {
      onMouseDown: handleMouseDown,
      style: {
        width: 4,
        cursor: "col-resize",
        flexShrink: 0,
        transition: "background 0.15s",
        background: "var(--sna-resize-handle)"
      },
      onMouseEnter: (e) => {
        e.currentTarget.style.background = "var(--sna-resize-handle-hover, rgba(139,92,246,0.3))";
      },
      onMouseLeave: (e) => {
        e.currentTarget.style.background = "var(--sna-resize-handle, transparent)";
      }
    }
  );
}
export {
  ResizeHandle
};
