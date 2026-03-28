"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
let messageCounter = 0;
function emptySession() {
  return { messages: [], processedEventIds: /* @__PURE__ */ new Set() };
}
const useChatStore = create()(
  persist(
    (set, get) => ({
      isOpen: false,
      width: 380,
      activeSessionId: "default",
      sessions: { main: emptySession() },
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setWidth: (width) => set({ width: Math.max(320, Math.min(520, width)) }),
      setActiveSession: (id) => {
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
      addMessage: (msg, sessionId) => {
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
                  { ...msg, id: `msg-${++messageCounter}`, timestamp: Date.now() }
                ]
              }
            }
          };
        });
      },
      clearMessages: (sessionId) => {
        const id = sessionId ?? get().activeSessionId;
        set((state) => ({
          sessions: {
            ...state.sessions,
            [id]: emptySession()
          }
        }));
      },
      markEventProcessed: (eventId, sessionId) => {
        const id = sessionId ?? get().activeSessionId;
        const session = get().sessions[id];
        if (!session) return true;
        if (session.processedEventIds.has(eventId)) return false;
        const next = new Set(session.processedEventIds);
        next.add(eventId);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [id]: { ...state.sessions[id], processedEventIds: next }
          }
        }));
        return true;
      }
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
              messages: sess.messages.map(
                (m) => m.meta?.animate ? { ...m, meta: { ...m.meta, animate: void 0 } } : m
              ),
              processedEventIds: [...sess.processedEventIds]
            }
          ])
        )
      }),
      merge: (persisted, current) => {
        if (!persisted) return current;
        if (persisted.messages && !persisted.sessions) {
          const mainSession = {
            messages: persisted.messages ?? [],
            processedEventIds: new Set(persisted.processedEventIds ?? [])
          };
          return {
            ...current,
            isOpen: persisted.isOpen ?? current.isOpen,
            width: persisted.width ?? current.width,
            activeSessionId: "default",
            sessions: { main: mainSession }
          };
        }
        const sessions = {};
        for (const [sid, sess] of Object.entries(persisted.sessions ?? {})) {
          const s = sess;
          sessions[sid] = {
            messages: s.messages ?? [],
            processedEventIds: new Set(s.processedEventIds ?? [])
          };
        }
        return {
          ...current,
          isOpen: persisted.isOpen ?? current.isOpen,
          width: persisted.width ?? current.width,
          activeSessionId: persisted.activeSessionId ?? "default",
          sessions: { ...current.sessions, ...sessions }
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        let total = 0;
        for (const sess of Object.values(state.sessions)) {
          total += sess.messages.length;
        }
        if (total > 0) messageCounter = total;
      }
    }
  )
);
export {
  useChatStore
};
