"use client";

import { create } from "zustand";

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

  // API URL for DB sync (set by SnaProvider)
  _apiUrl: string;
  _setApiUrl: (url: string) => void;

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

  // DB sync
  hydrate: () => Promise<void>;
}

let messageCounter = 0;

function emptySession(): SessionChatState {
  return { messages: [], processedEventIds: new Set() };
}

function syncCreateSession(apiUrl: string, id: string, label?: string, type?: string) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, label: label ?? id, type: type ?? "background" }),
  }).catch(() => { /* non-fatal */ });
}

function syncDeleteSession(apiUrl: string, id: string) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(id)}`, { method: "DELETE" })
    .catch(() => { /* non-fatal */ });
}

function syncClearMessages(apiUrl: string, sessionId: string) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "DELETE" })
    .catch(() => { /* non-fatal */ });
}

export const useChatStore = create<ChatState>()(
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

    addMessage: (msg, sessionId?) => {
      const id = sessionId ?? get().activeSessionId;
      const fullMsg = { ...msg, id: `msg-${++messageCounter}`, timestamp: Date.now() };
      set((state) => {
        const session = state.sessions[id] ?? emptySession();
        return {
          sessions: {
            ...state.sessions,
            [id]: {
              ...session,
              messages: [...session.messages, fullMsg],
            },
          },
        };
      });
      // Server persists messages automatically (agent routes).
      // No client-side sync needed.
    },

    clearMessages: (sessionId?) => {
      const id = sessionId ?? get().activeSessionId;
      set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: emptySession(),
        },
      }));
      syncClearMessages(get()._apiUrl, id);
    },

    markEventProcessed: (eventId, sessionId?) => {
      const id = sessionId ?? get().activeSessionId;
      const session = get().sessions[id];
      if (!session) return true;
      if (session.processedEventIds.has(eventId)) return false;
      const next = new Set(session.processedEventIds);
      next.add(eventId);
      if (next.size > 10000) {
        const arr = Array.from(next);
        const keep = arr.slice(arr.length >> 1);
        next.clear();
        for (const id of keep) next.add(id);
      }
      set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: { ...state.sessions[id], processedEventIds: next },
        },
      }));
      return true;
    },

    hydrate: async () => {
      const apiUrl = get()._apiUrl;
      if (!apiUrl) return;

      try {
        // Fetch all sessions
        const sessRes = await fetch(`${apiUrl}/chat/sessions`);
        const sessData = await sessRes.json();
        const dbSessions = sessData.sessions as Array<{ id: string; label: string; type: string }>;

        const sessions: Record<string, SessionChatState> = {};

        // Fetch messages for each session
        for (const sess of dbSessions) {
          try {
            const msgRes = await fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(sess.id)}/messages`);
            const msgData = await msgRes.json();
            const messages = (msgData.messages as Array<{
              id: number; role: string; content: string;
              skill_name: string | null; meta: string | null; created_at: string;
            }>).map((m) => ({
              id: `db-${m.id}`,
              role: m.role as ChatMessage["role"],
              content: m.content,
              timestamp: new Date(m.created_at).getTime(),
              skillName: m.skill_name ?? undefined,
              meta: m.meta ? JSON.parse(m.meta) : undefined,
            }));
            sessions[sess.id] = { messages, processedEventIds: new Set() };
            if (messages.length > messageCounter) messageCounter = messages.length;
          } catch {
            sessions[sess.id] = emptySession();
          }
        }

        // Ensure default session exists
        if (!sessions.default) {
          sessions.default = emptySession();
        }

        set({ sessions });
      } catch {
        // Server not ready — start with empty state
      }
    },
  }),
);
