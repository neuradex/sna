"use client";
import { create } from "zustand";
let messageCounter = 0;
function emptySession() {
  return { messages: [], processedEventIds: /* @__PURE__ */ new Set() };
}
function syncMessage(apiUrl, sessionId, msg) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: msg.role,
      content: msg.content,
      skill_name: msg.skillName,
      meta: msg.meta
    })
  }).catch(() => {
  });
}
function syncCreateSession(apiUrl, id, label, type) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, label: label ?? id, type: type ?? "background" })
  }).catch(() => {
  });
}
function syncDeleteSession(apiUrl, id) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {
  });
}
function syncClearMessages(apiUrl, sessionId) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "DELETE" }).catch(() => {
  });
}
const useChatStore = create()(
  (set, get) => ({
    isOpen: false,
    width: 380,
    activeSessionId: "default",
    sessions: { default: emptySession() },
    _apiUrl: "",
    _setApiUrl: (url) => set({ _apiUrl: url }),
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
        syncCreateSession(get()._apiUrl, id);
      }
    },
    removeSession: (id) => {
      if (id === "default") return;
      const s = { ...get().sessions };
      delete s[id];
      const activeSessionId = get().activeSessionId === id ? "default" : get().activeSessionId;
      set({ sessions: s, activeSessionId });
      syncDeleteSession(get()._apiUrl, id);
    },
    addMessage: (msg, sessionId) => {
      const id = sessionId ?? get().activeSessionId;
      const fullMsg = { ...msg, id: `msg-${++messageCounter}`, timestamp: Date.now() };
      set((state) => {
        const session = state.sessions[id] ?? emptySession();
        return {
          sessions: {
            ...state.sessions,
            [id]: {
              ...session,
              messages: [...session.messages, fullMsg]
            }
          }
        };
      });
      syncMessage(get()._apiUrl, id, msg);
    },
    clearMessages: (sessionId) => {
      const id = sessionId ?? get().activeSessionId;
      set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: emptySession()
        }
      }));
      syncClearMessages(get()._apiUrl, id);
    },
    markEventProcessed: (eventId, sessionId) => {
      const id = sessionId ?? get().activeSessionId;
      const session = get().sessions[id];
      if (!session) return true;
      if (session.processedEventIds.has(eventId)) return false;
      const next = new Set(session.processedEventIds);
      next.add(eventId);
      if (next.size > 1e4) {
        const arr = Array.from(next);
        const keep = arr.slice(arr.length >> 1);
        next.clear();
        for (const id2 of keep) next.add(id2);
      }
      set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: { ...state.sessions[id], processedEventIds: next }
        }
      }));
      return true;
    },
    hydrate: async () => {
      const apiUrl = get()._apiUrl;
      if (!apiUrl) return;
      try {
        const sessRes = await fetch(`${apiUrl}/chat/sessions`);
        const sessData = await sessRes.json();
        const dbSessions = sessData.sessions;
        const sessions = {};
        for (const sess of dbSessions) {
          try {
            const msgRes = await fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(sess.id)}/messages`);
            const msgData = await msgRes.json();
            const messages = msgData.messages.map((m) => ({
              id: `db-${m.id}`,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.created_at).getTime(),
              skillName: m.skill_name ?? void 0,
              meta: m.meta ? JSON.parse(m.meta) : void 0
            }));
            sessions[sess.id] = { messages, processedEventIds: /* @__PURE__ */ new Set() };
            if (messages.length > messageCounter) messageCounter = messages.length;
          } catch {
            sessions[sess.id] = emptySession();
          }
        }
        if (!sessions.default) {
          sessions.default = emptySession();
        }
        set({ sessions });
      } catch {
      }
    }
  })
);
export {
  useChatStore
};
