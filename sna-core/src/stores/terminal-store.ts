"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TERMINAL_DEFAULT_HEIGHT } from "../lib/terminal/constants.js";

interface TerminalState {
  isOpen: boolean;
  height: number;
  fontSize: number;
  /** WebSocket is open and PTY is spawned */
  connected: boolean;
  /** WebSocket is currently connecting or reconnecting */
  isConnecting: boolean;
  writeFn: ((data: string) => void) | null;
  focusFn: (() => void) | null;
  fitFn: (() => void) | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setHeight: (height: number) => void;
  setFontSize: (fontSize: number) => void;
  setConnected: (connected: boolean) => void;
  setIsConnecting: (isConnecting: boolean) => void;
  setWriteFn: (fn: ((data: string) => void) | null) => void;
  setFocusFn: (fn: (() => void) | null) => void;
  setFitFn: (fn: (() => void) | null) => void;
  sendToTerminal: (text: string) => void;
  /** Send a skill command via /sna-sub so it runs as a subagent */
  sendToTerminalSub: (text: string) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      isOpen: false,
      height: TERMINAL_DEFAULT_HEIGHT,
      fontSize: 14,
      connected: false,
      isConnecting: false,
      writeFn: null,
      focusFn: null,
      fitFn: null,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setHeight: (height) => set({ height }),
      setFontSize: (fontSize) => set({ fontSize }),
      setConnected: (connected) => set({ connected }),
      setIsConnecting: (isConnecting) => set({ isConnecting }),
      setWriteFn: (fn) => set({ writeFn: fn }),
      setFocusFn: (fn) => set({ focusFn: fn }),
      setFitFn: (fn) => set({ fitFn: fn }),
      sendToTerminal: (text) => {
        const state = useTerminalStore.getState();
        if (state.writeFn) {
          // Ctrl+U でカレント行をクリアしてから入力
          state.writeFn("\x15");
          state.writeFn(text);
        }
      },
      sendToTerminalSub: (text) => {
        const state = useTerminalStore.getState();
        if (state.writeFn) {
          // /skill-name args → /sna-sub skill-name args
          const cleaned = text.replace(/[\r\n]+$/, "");
          const sub = cleaned.replace(/^\//, "/sna-sub ");
          // Ctrl+U でカレント行をクリア → 入力 → CR で送信
          state.writeFn("\x15");
          state.writeFn(sub + "\r");
        }
      },
    }),
    {
      name: "terminal-panel",
      partialize: (s) => ({ isOpen: s.isOpen, height: s.height, fontSize: s.fontSize }),
    }
  )
);
