"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TERMINAL_DEFAULT_HEIGHT } from "../lib/terminal/constants.js";
const useTerminalStore = create()(
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
          state.writeFn("");
          state.writeFn(text);
        }
      },
      sendToTerminalSub: (text) => {
        const state = useTerminalStore.getState();
        if (state.writeFn) {
          const cleaned = text.replace(/[\r\n]+$/, "");
          const sub = cleaned.replace(/^\//, "/sna-sub ");
          state.writeFn("");
          state.writeFn(sub + "\r");
        }
      }
    }),
    {
      name: "terminal-panel",
      partialize: (s) => ({ isOpen: s.isOpen, height: s.height, fontSize: s.fontSize })
    }
  )
);
export {
  useTerminalStore
};
