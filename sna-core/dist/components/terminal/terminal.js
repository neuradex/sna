"use client";
import { jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { wsManager } from "../../lib/terminal/ws-manager.js";
import { useTerminalStore } from "../../stores/terminal-store.js";
import "@xterm/xterm/css/xterm.css";
function Terminal({ dangerouslySkipPermissions = false }) {
  const containerRef = useRef(null);
  const setConnected = useTerminalStore((s) => s.setConnected);
  const setIsConnecting = useTerminalStore((s) => s.setIsConnecting);
  const setWriteFn = useTerminalStore((s) => s.setWriteFn);
  const setFocusFn = useTerminalStore((s) => s.setFocusFn);
  const setFitFn = useTerminalStore((s) => s.setFitFn);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const fontSize = useTerminalStore((s) => s.fontSize);
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = fontSize;
    fit.fit();
    if (wsManager.connected) {
      wsManager.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  }, [fontSize]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initialFontSize = useTerminalStore.getState().fontSize;
    const term = new XTerm({
      fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace",
      fontSize: initialFontSize,
      theme: {
        background: "#0d0d14",
        foreground: "#e0e0f0",
        cursor: "#a78bfa",
        selectionBackground: "#3a3a5a",
        black: "#1c1c2e",
        brightBlack: "#4a4a6a"
      },
      cursorBlink: true,
      allowProposedApi: true
    });
    const fitAddon = new FitAddon();
    termRef.current = term;
    fitRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    requestAnimationFrame(() => fitAddon.fit());
    setFocusFn(() => term.focus());
    setFitFn(() => fitAddon.fit());
    let isComposing = false;
    let lastComposed = "";
    let endFrameId = null;
    const textarea = container.querySelector("textarea");
    const onCompStart = () => {
      isComposing = true;
      if (endFrameId !== null) {
        cancelAnimationFrame(endFrameId);
        endFrameId = null;
      }
    };
    const onCompEnd = (e) => {
      if (e.data) {
        wsManager.send(e.data);
        lastComposed = e.data;
      }
      endFrameId = requestAnimationFrame(() => {
        isComposing = false;
        endFrameId = null;
      });
    };
    textarea?.addEventListener("compositionstart", onCompStart);
    textarea?.addEventListener("compositionend", onCompEnd);
    term.onData((data) => {
      if (isComposing) return;
      if (lastComposed && data === lastComposed) {
        lastComposed = "";
        return;
      }
      lastComposed = "";
      wsManager.send(data);
    });
    const unsub = wsManager.subscribe({
      onData: (data) => term.write(data),
      onOpen: () => {
        setConnected(true);
        setIsConnecting(false);
        setWriteFn((data) => wsManager.send(data));
        fitAddon.fit();
        wsManager.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      },
      onClose: () => {
        setConnected(false);
      },
      onConnecting: () => {
        setIsConnecting(true);
      },
      onRestart: () => {
        term.clear();
        term.write("\x1B[2J\x1B[H");
        term.write("\x1B[38;5;141m\u27F3 Restarting terminal\u2026\x1B[0m\r\n\r\n");
        setConnected(false);
        setIsConnecting(true);
      }
    });
    wsManager.connect({ dangerouslySkipPermissions });
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
        if (wsManager.connected) {
          wsManager.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      });
    });
    ro.observe(container);
    return () => {
      textarea?.removeEventListener("compositionstart", onCompStart);
      textarea?.removeEventListener("compositionend", onCompEnd);
      if (endFrameId !== null) cancelAnimationFrame(endFrameId);
      ro.disconnect();
      unsub();
      setFocusFn(null);
      setFitFn(null);
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
  }, [dangerouslySkipPermissions, setConnected, setIsConnecting, setWriteFn, setFocusFn, setFitFn]);
  return /* @__PURE__ */ jsx("div", { ref: containerRef, className: "h-full w-full", style: { padding: "4px 0 0 4px" } });
}
export {
  Terminal
};
