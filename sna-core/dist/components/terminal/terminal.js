"use client";
import { jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { TERMINAL_WS_URL } from "../../lib/terminal/constants.js";
import { useTerminalStore } from "../../stores/terminal-store.js";
import "@xterm/xterm/css/xterm.css";
const RECONNECT_DELAY = 3e3;
function Terminal({ dangerouslySkipPermissions = false }) {
  const containerRef = useRef(null);
  const setConnected = useTerminalStore((s) => s.setConnected);
  const setIsConnecting = useTerminalStore((s) => s.setIsConnecting);
  const setWriteFn = useTerminalStore((s) => s.setWriteFn);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let ws = null;
    let reconnectTimer = null;
    const term = new XTerm({
      fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace",
      fontSize: 12,
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
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    requestAnimationFrame(() => fitAddon.fit());
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });
    function connect() {
      if (disposed) return;
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      setIsConnecting(true);
      const socket = new WebSocket(TERMINAL_WS_URL);
      ws = socket;
      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "init", dangerouslySkipPermissions }));
        setConnected(true);
        setIsConnecting(false);
        setWriteFn((data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        fitAddon.fit();
        socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };
      socket.onmessage = (e) => {
        if (!disposed) term.write(e.data);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!disposed) {
          setIsConnecting(true);
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
        }
      };
    }
    connect();
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (disposed) return;
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      });
    });
    ro.observe(container);
    return () => {
      disposed = true;
      ro.disconnect();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      setConnected(false);
      setIsConnecting(false);
      setWriteFn(null);
      term.dispose();
    };
  }, [dangerouslySkipPermissions, setConnected, setIsConnecting, setWriteFn]);
  return /* @__PURE__ */ jsx("div", { ref: containerRef, className: "h-full w-full", style: { padding: "4px 0 0 4px" } });
}
export {
  Terminal
};
