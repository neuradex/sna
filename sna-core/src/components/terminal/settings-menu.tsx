"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTerminalStore } from "../../stores/terminal-store.js";
import { wsManager } from "../../lib/terminal/ws-manager.js";
import { TERMINAL_DEFAULT_HEIGHT } from "../../lib/terminal/constants.js";

const FONT_SIZES = [12, 13, 14, 15, 16] as const;

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { fontSize, setFontSize, setHeight } = useTerminalStore();

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const handleResetHeight = useCallback(() => {
    setHeight(TERMINAL_DEFAULT_HEIGHT);
  }, [setHeight]);

  const handleClearTerminal = useCallback(() => {
    const { writeFn } = useTerminalStore.getState();
    if (writeFn) {
      // Send Ctrl+L to clear terminal
      writeFn("\x0c");
    }
    setOpen(false);
  }, []);

  const handleRestart = useCallback(() => {
    wsManager.restart();
    setOpen(false);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      {/* ... button */}
      <button
        ref={btnRef}
        title="Settings"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        style={{
          background: open ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.15)",
          cursor: "pointer",
          padding: "3px 6px",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: open ? "#fff" : "rgba(255,255,255,0.7)",
          fontSize: 11,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.15)";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = "rgba(255,255,255,0.07)";
            e.currentTarget.style.color = "rgba(255,255,255,0.7)";
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            width: 220,
            backgroundColor: "#1e1e30",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            padding: "6px 0",
            zIndex: 100,
          }}
        >
          {/* Font Size */}
          <div style={{ padding: "8px 12px 4px" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Font Size
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "2px 12px 8px" }}>
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                onClick={() => setFontSize(size)}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  fontSize: 11,
                  fontWeight: fontSize === size ? 600 : 400,
                  color: fontSize === size ? "#fff" : "rgba(255,255,255,0.5)",
                  background: fontSize === size ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.05)",
                  border: fontSize === size ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 4,
                  cursor: "pointer",
                  transition: "all 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (fontSize !== size) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                    e.currentTarget.style.color = "rgba(255,255,255,0.8)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (fontSize !== size) {
                    e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                    e.currentTarget.style.color = "rgba(255,255,255,0.5)";
                  }
                }}
              >
                {size}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.08)", margin: "2px 0" }} />

          {/* Actions */}
          <MenuItem
            label="Clear terminal"
            shortcut="^L"
            onClick={handleClearTerminal}
          />
          <MenuItem
            label="Reset panel height"
            onClick={handleResetHeight}
          />
          <MenuItem
            label="Restart connection"
            onClick={handleRestart}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, shortcut, onClick }: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "6px 12px",
        fontSize: 12,
        color: "rgba(255,255,255,0.8)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        e.currentTarget.style.color = "#fff";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "rgba(255,255,255,0.8)";
      }}
    >
      <span>{label}</span>
      {shortcut && (
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{shortcut}</span>
      )}
    </button>
  );
}
