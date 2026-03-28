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

interface SessionChatState {
  messages: ChatMessage[];
  processedEventIds: Set<number>;
}

interface ChatState {
  // Global UI state
  isOpen: boolean;
  width: number;
  activeSessionId: string;

  // Per-session state
  sessions: Record<string, SessionChatState>;

  // Global actions
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setWidth: (width: number) => void;

  // Session management
  setActiveSession: (id: string) => void;
  initSession: (id: string) => void;
  removeSession: (id: string) => void;

  // Session-scoped actions (default: activeSessionId)
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => void;
  clearMessages: (sessionId?: string) => void;
  /** Returns true if this event has NOT been processed yet (and marks it). */
  markEventProcessed: (eventId: number, sessionId?: string) => boolean;
}

let messageCounter = 0;

function emptySession(): SessionChatState {
  return { messages: [], processedEventIds: new Set() };
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      width: 380,
      activeSessionId: "default",
      sessions: { default: emptySession() },

      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setWidth: (width) => set({ width: Math.max(320, Math.min(520, width)) }),

      setActiveSession: (id) => {
        // Lazily init session if needed
        const s = get().sessions;
        if (!s[id]) {
          set({ activeSessionId: id, sessions: { ...s, [id]: emptySession() } });
        } else {
          set({ activeSessionId: id });
        }
      },

      initSession: (id) => {
        const s = get().sessions;
        if (!s[id]) {
          set({ sessions: { ...s, [id]: emptySession() } });
        }
      },

      removeSession: (id) => {
        if (id === "default") return;
        const s = { ...get().sessions };
        delete s[id];
        const activeSessionId = get().activeSessionId === id ? "default" : get().activeSessionId;
        set({ sessions: s, activeSessionId });
      },

      addMessage: (msg, sessionId?) => {
        const id = sessionId ?? get().activeSessionId;
        set((state) => {
          const session = state.sessions[id] ?? emptySession();
          return {
            sessions: {
              ...state.sessions,
              [id]: {
                ...session,
                messages: [
                  ...session.messages,
                  { ...msg, id: `msg-${++messageCounter}`, timestamp: Date.now() },
                ],
              },
            },
          };
        });
      },

      clearMessages: (sessionId?) => {
        const id = sessionId ?? get().activeSessionId;
        set((state) => ({
          sessions: {
            ...state.sessions,
            [id]: emptySession(),
          },
        }));
      },

      markEventProcessed: (eventId, sessionId?) => {
        const id = sessionId ?? get().activeSessionId;
        const session = get().sessions[id];
        if (!session) return true; // no session = treat as new
        if (session.processedEventIds.has(eventId)) return false;
        const next = new Set(session.processedEventIds);
        next.add(eventId);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [id]: { ...state.sessions[id], processedEventIds: next },
          },
        }));
        return true;
      },
    }),
    {
      name: "sna-chat-panel",
      partialize: (s) => ({
        isOpen: s.isOpen,
        width: s.width,
        activeSessionId: s.activeSessionId,
        sessions: Object.fromEntries(
          Object.entries(s.sessions).map(([sid, sess]) => [
            sid,
            {
              // Strip transient flags (animate) so they don't replay on reload
              messages: sess.messages.map((m) =>
                m.meta?.animate ? { ...m, meta: { ...m.meta, animate: undefined } } : m
              ),
              processedEventIds: [...sess.processedEventIds],
            },
          ])
        ),
      }),
      merge: (persisted: any, current): ChatState => {
        if (!persisted) return current;

        // Migration: old flat format → session-partitioned
        if (persisted.messages && !persisted.sessions) {
          const mainSession: SessionChatState = {
            messages: persisted.messages ?? [],
            processedEventIds: new Set<number>(persisted.processedEventIds ?? []),
          };
          return {
            ...current,
            isOpen: persisted.isOpen ?? current.isOpen,
            width: persisted.width ?? current.width,
            activeSessionId: "default",
            sessions: { default: mainSession },
          };
        }

        // New format: restore Sets from arrays in each session
        const sessions: Record<string, SessionChatState> = {};
        for (const [sid, sess] of Object.entries(persisted.sessions ?? {})) {
          const s = sess as any;
          sessions[sid] = {
            messages: s.messages ?? [],
            processedEventIds: new Set<number>(s.processedEventIds ?? []),
          };
        }

        return {
          ...current,
          isOpen: persisted.isOpen ?? current.isOpen,
          width: persisted.width ?? current.width,
          activeSessionId: persisted.activeSessionId ?? "default",
          sessions: { ...current.sessions, ...sessions },
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Restore messageCounter from total persisted messages
        let total = 0;
        for (const sess of Object.values(state.sessions)) {
          total += sess.messages.length;
        }
        if (total > 0) messageCounter = total;
      },
    }
  )
);
