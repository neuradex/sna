import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TERMINAL_DEFAULT_WIDTH } from "@/lib/terminal/constants";

interface TerminalState {
  isOpen: boolean;
  width: number;
  connected: boolean;
  writeFn: ((data: string) => void) | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setWidth: (width: number) => void;
  setConnected: (connected: boolean) => void;
  setWriteFn: (fn: ((data: string) => void) | null) => void;
  sendToTerminal: (text: string) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      isOpen: false,
      width: TERMINAL_DEFAULT_WIDTH,
      connected: false,
      writeFn: null,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setWidth: (width) => set({ width }),
      setConnected: (connected) => set({ connected }),
      setWriteFn: (fn) => set({ writeFn: fn }),
      sendToTerminal: (text) => {
        const { writeFn } = useTerminalStore.getState();
        if (writeFn) writeFn(text);
      },
    }),
    {
      name: "terminal-panel",
      partialize: (s) => ({ isOpen: s.isOpen, width: s.width }),
    }
  )
);
