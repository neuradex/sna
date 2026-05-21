"use client";
import { create } from "zustand";
import { authHeaders } from "../context.js";
let messageCounter = 0;
function emptySession() {
  return { messages: [], processedEventIds: /* @__PURE__ */ new Set() };
}
function actorKindToRole(actor, kind) {
  if (actor === "user") return "user";
  if (actor === "assistant") {
    if (kind === "thinking") return "thinking";
    if (kind === "tool_use") return "tool";
    return "assistant";
  }
  if (kind === "tool_result") return "tool_result";
  if (kind === "error") return "error";
  return "status";
}
function syncCreateSession(apiUrl, authToken, id, label, type) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions`, {
    method: "POST",
    headers: authHeaders(authToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id, label: label ?? id, type: type ?? "background" })
  }).catch(() => {
  });
}
function syncDeleteSession(apiUrl, authToken, id) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(authToken)
  }).catch(() => {
  });
}
function syncClearMessages(apiUrl, authToken, sessionId) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "DELETE",
    headers: authHeaders(authToken)
  }).catch(() => {
  });
}
const useChatStore = create()(
  (set, get) => ({
    isOpen: false,
    width: 380,
    activeSessionId: "default",
    sessions: { default: emptySession() },
    _apiUrl: "",
    _authToken: void 0,
    _setApiUrl: (url) => set({ _apiUrl: url }),
    _setAuthToken: (token) => set({ _authToken: token }),
    _hydratedSessions: /* @__PURE__ */ new Set(),
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
      get().fetchSessionMessages(id);
    },
    initSession: (id) => {
      const s = get().sessions;
      if (!s[id]) {
        set({ sessions: { ...s, [id]: emptySession() } });
        syncCreateSession(get()._apiUrl, get()._authToken, id);
      }
    },
    removeSession: (id) => {
      if (id === "default") return;
      const s = { ...get().sessions };
      delete s[id];
      const activeSessionId = get().activeSessionId === id ? "default" : get().activeSessionId;
      set({ sessions: s, activeSessionId });
      syncDeleteSession(get()._apiUrl, get()._authToken, id);
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
    },
    clearMessages: (sessionId) => {
      const id = sessionId ?? get().activeSessionId;
      set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: emptySession()
        }
      }));
      syncClearMessages(get()._apiUrl, get()._authToken, id);
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
        const sessRes = await fetch(`${apiUrl}/chat/sessions`, {
          headers: authHeaders(get()._authToken)
        });
        const sessData = await sessRes.json();
        const dbSessions = sessData.sessions;
        const sessions = {};
        for (const sess of dbSessions) {
          sessions[sess.id] = emptySession();
        }
        if (!sessions.default) {
          sessions.default = emptySession();
        }
        set({ sessions });
        const activeId = get().activeSessionId;
        if (sessions[activeId]) {
          get().fetchSessionMessages(activeId);
        }
      } catch {
      }
    },
    fetchSessionMessages: async (sessionId) => {
      const { _apiUrl: apiUrl, _hydratedSessions } = get();
      if (!apiUrl || _hydratedSessions.has(sessionId)) return;
      const next = new Set(_hydratedSessions);
      next.add(sessionId);
      set({ _hydratedSessions: next });
      try {
        const msgRes = await fetch(
          `${apiUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
          { headers: authHeaders(get()._authToken) }
        );
        const msgData = await msgRes.json();
        const messages = msgData.messages.map((m) => ({
          id: `db-${m.id}`,
          role: actorKindToRole(m.actor, m.kind),
          content: m.content,
          timestamp: new Date(m.created_at).getTime(),
          meta: m.meta ? JSON.parse(m.meta) : void 0
        }));
        if (messages.length > messageCounter) messageCounter = messages.length;
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...state.sessions[sessionId],
              messages
            }
          }
        }));
      } catch {
      }
    }
  })
);
export {
  useChatStore
};
