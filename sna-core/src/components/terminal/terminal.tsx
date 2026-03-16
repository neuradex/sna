"use client";

import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { wsManager } from "../../lib/terminal/ws-manager.js";
import { useTerminalStore } from "../../stores/terminal-store.js";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  dangerouslySkipPermissions?: boolean;
}

export function Terminal({ dangerouslySkipPermissions = false }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setConnected = useTerminalStore((s) => s.setConnected);
  const setIsConnecting = useTerminalStore((s) => s.setIsConnecting);
  const setWriteFn = useTerminalStore((s) => s.setWriteFn);
  const setFocusFn = useTerminalStore((s) => s.setFocusFn);
  const setFitFn = useTerminalStore((s) => s.setFitFn);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // React to fontSize changes
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

    // -- xterm (local to this mount — lightweight, OK to recreate) ------------
    const term = new XTerm({
      fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace",
      fontSize: initialFontSize,
      theme: {
        background: "#0d0d14",
        foreground: "#e0e0f0",
        cursor: "#a78bfa",
        selectionBackground: "#3a3a5a",
        black: "#1c1c2e",
        brightBlack: "#4a4a6a",
      },
      cursorBlink: true,
      allowProposedApi: true,
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

    // -- IME composition tracking (Korean/Japanese/Chinese) -------------------
    //
    // Korean IME is special: compositionend → compositionstart fire back-to-back
    // when a syllable boundary splits (e.g. 한 → 한 + ㄱ). The onData event for
    // the new leading consonant can fire BEFORE compositionstart, leaking raw jamo.
    //
    // Strategy:
    //  1. Suppress ALL onData while composing
    //  2. Send composed text directly from compositionend (e.data)
    //  3. Deduplicate: skip the onData that fires right after compositionend
    //     with the same text (xterm.js sometimes sends it again)
    //  4. Use cancelAnimationFrame to handle rapid compositionend→compositionstart
    //
    let isComposing = false;
    let lastComposed = "";
    let endFrameId: number | null = null;
    const textarea = container.querySelector("textarea");

    const onCompStart = () => {
      isComposing = true;
      // Cancel the pending "unlock" from a previous compositionend —
      // this is the Korean syllable-split case (compositionend → compositionstart)
      if (endFrameId !== null) {
        cancelAnimationFrame(endFrameId);
        endFrameId = null;
      }
    };

    const onCompEnd = (e: CompositionEvent) => {
      // Send the final composed text immediately
      if (e.data) {
        wsManager.send(e.data);
        lastComposed = e.data;
      }
      // Keep isComposing=true briefly to suppress the stray onData,
      // then unlock in the next animation frame.
      // If compositionstart fires before the frame (Korean syllable split),
      // we cancel this via onCompStart above.
      endFrameId = requestAnimationFrame(() => {
        isComposing = false;
        endFrameId = null;
      });
    };

    textarea?.addEventListener("compositionstart", onCompStart);
    textarea?.addEventListener("compositionend", onCompEnd as EventListener);

    // -- Wire xterm ↔ singleton WebSocket manager ----------------------------
    term.onData((data) => {
      if (isComposing) return;
      // Deduplicate: skip if this is the same text we just sent via compositionend
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
        setWriteFn((data: string) => wsManager.send(data));
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
        term.write("\x1b[2J\x1b[H");
        term.write("\x1b[38;5;141m⟳ Restarting terminal…\x1b[0m\r\n\r\n");
        setConnected(false);
        setIsConnecting(true);
      },
    });

    // Start connection (idempotent — reuses existing if alive)
    wsManager.connect({ dangerouslySkipPermissions });

    // -- Resize observer -----------------------------------------------------
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
        if (wsManager.connected) {
          wsManager.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      });
    });
    ro.observe(container);

    // -- Cleanup (only xterm + listener — WebSocket stays alive) -------------
    return () => {
      textarea?.removeEventListener("compositionstart", onCompStart);
      textarea?.removeEventListener("compositionend", onCompEnd as EventListener);
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

  return <div ref={containerRef} className="h-full w-full" style={{ padding: "4px 0 0 4px" }} />;
}
