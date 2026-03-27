"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "thinking" | "status" | "error" | "permission" | "tool" | "tool_result" | "skill";
  content: string;
  timestamp: number;
  skillName?: string;
  /** Extra data for rich rendering (tool input, skill events, etc.) */
  meta?: Record<string, unknown>;
}

interface ChatState {
  isOpen: boolean;
  width: number;
  messages: ChatMessage[];
  /** Tracks event IDs that have already been converted to chat messages */
  processedEventIds: Set<number>;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setWidth: (width: number) => void;
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  clearMessages: () => void;
  markEventProcessed: (eventId: number) => boolean;
}

let messageCounter = 0;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      width: 380,
      messages: [],
      processedEventIds: new Set(),
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setWidth: (width) => set({ width: Math.max(320, Math.min(520, width)) }),
      addMessage: (msg) =>
        set((s) => ({
          messages: [
            ...s.messages,
            { ...msg, id: `msg-${++messageCounter}`, timestamp: Date.now() },
          ],
        })),
      clearMessages: () => {
        messageCounter = 0;
        set({ messages: [], processedEventIds: new Set() });
      },
      /** Returns true if this event has NOT been processed yet (and marks it). */
      markEventProcessed: (eventId) => {
        const ids = get().processedEventIds;
        if (ids.has(eventId)) return false;
        const next = new Set(ids);
        next.add(eventId);
        set({ processedEventIds: next });
        return true;
      },
    }),
    {
      name: "sna-chat-panel",
      partialize: (s) => ({
        isOpen: s.isOpen,
        width: s.width,
        // Strip transient flags (animate) so they don't replay on reload
        messages: s.messages.map((m) =>
          m.meta?.animate ? { ...m, meta: { ...m.meta, animate: undefined } } : m
        ),
        // processedEventIds as array for JSON serialization
        processedEventIds: [...s.processedEventIds],
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...(persisted as object),
        // Restore Set from array
        processedEventIds: new Set(persisted?.processedEventIds ?? []),
        // Restore messageCounter from persisted messages
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.messages.length) {
          messageCounter = state.messages.length;
        }
      },
    }
  )
);
