"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TERMINAL_DEFAULT_WIDTH } from "../lib/terminal/constants.js";
const useTerminalStore = create()(
  persist(
    (set) => ({
      isOpen: false,
      width: TERMINAL_DEFAULT_WIDTH,
      connected: false,
      isConnecting: false,
      writeFn: null,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setWidth: (width) => set({ width }),
      setConnected: (connected) => set({ connected }),
      setIsConnecting: (isConnecting) => set({ isConnecting }),
      setWriteFn: (fn) => set({ writeFn: fn }),
      sendToTerminal: (text) => {
        const state = useTerminalStore.getState();
        if (state.writeFn) state.writeFn(text);
      }
    }),
    {
      name: "terminal-panel",
      partialize: (s) => ({ isOpen: s.isOpen, width: s.width })
    }
  )
);
export {
  useTerminalStore
};
