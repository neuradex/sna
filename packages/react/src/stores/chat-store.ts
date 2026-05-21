"use client";

import { create } from "zustand";
import { authHeaders } from "../context.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "thinking" | "status" | "error" | "permission" | "tool" | "tool_result";
  content: string;
  timestamp: number;
  /** Extra data for rich rendering (tool input, animation flags, etc.) */
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
  _authToken?: string;
  _setApiUrl: (url: string) => void;
  _setAuthToken: (token: string | undefined) => void;
  /** Tracks which sessions have had their messages fetched */
  _hydratedSessions: Set<string>;

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
  /** Hydrate session list only (no messages). */
  hydrate: () => Promise<void>;
  /** Lazy-fetch messages for a specific session. No-op if already fetched. */
  fetchSessionMessages: (sessionId: string) => Promise<void>;
}

let messageCounter = 0;

function emptySession(): SessionChatState {
  return { messages: [], processedEventIds: new Set() };
}

/** Map canonical (actor, kind) pair into UI role. */
function actorKindToRole(actor: string, kind: string): ChatMessage["role"] {
  if (actor === "user") return "user";
  if (actor === "assistant") {
    if (kind === "thinking") return "thinking";
    if (kind === "tool_use") return "tool";
    return "assistant";
  }
  // actor === "system"
  if (kind === "tool_result") return "tool_result";
  if (kind === "error") return "error";
  return "status";
}

function syncCreateSession(apiUrl: string, authToken: string | undefined, id: string, label?: string, type?: string) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions`, {
    method: "POST",
    headers: authHeaders(authToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id, label: label ?? id, type: type ?? "background" }),
  }).catch(() => { /* non-fatal */ });
}

function syncDeleteSession(apiUrl: string, authToken: string | undefined, id: string) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(authToken),
  })
    .catch(() => { /* non-fatal */ });
}

function syncClearMessages(apiUrl: string, authToken: string | undefined, sessionId: string) {
  if (!apiUrl) return;
  fetch(`${apiUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "DELETE",
    headers: authHeaders(authToken),
  })
    .catch(() => { /* non-fatal */ });
}

export const useChatStore = create<ChatState>()(
  (set, get) => ({
    isOpen: false,
    width: 380,
    activeSessionId: "default",
    sessions: { default: emptySession() },
    _apiUrl: "",
    _authToken: undefined,
    _setApiUrl: (url) => set({ _apiUrl: url }),
    _setAuthToken: (token) => set({ _authToken: token }),
    _hydratedSessions: new Set<string>(),

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
      // Lazy-fetch messages if not yet hydrated
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
      syncClearMessages(get()._apiUrl, get()._authToken, id);
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
        // Fetch session metadata only — no messages
        const sessRes = await fetch(`${apiUrl}/chat/sessions`, {
          headers: authHeaders(get()._authToken),
        });
        const sessData = await sessRes.json();
        const dbSessions = sessData.sessions as Array<{ id: string; label: string; type: string }>;

        const sessions: Record<string, SessionChatState> = {};
        for (const sess of dbSessions) {
          sessions[sess.id] = emptySession();
        }

        // Ensure default session exists
        if (!sessions.default) {
          sessions.default = emptySession();
        }

        set({ sessions });

        // Auto-fetch messages for the active session only
        const activeId = get().activeSessionId;
        if (sessions[activeId]) {
          get().fetchSessionMessages(activeId);
        }
      } catch {
        // Server not ready — start with empty state
      }
    },

    fetchSessionMessages: async (sessionId) => {
      const { _apiUrl: apiUrl, _hydratedSessions } = get();
      if (!apiUrl || _hydratedSessions.has(sessionId)) return;

      // Mark as hydrated immediately to prevent concurrent fetches
      const next = new Set(_hydratedSessions);
      next.add(sessionId);
      set({ _hydratedSessions: next });

      try {
        const msgRes = await fetch(
          `${apiUrl}/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
          { headers: authHeaders(get()._authToken) },
        );
        const msgData = await msgRes.json();
        const messages = (msgData.messages as Array<{
          id: number; actor: string; kind: string; content: string;
          meta: string | null; created_at: string;
        }>).map((m) => ({
          id: `db-${m.id}`,
          role: actorKindToRole(m.actor, m.kind),
          content: m.content,
          timestamp: new Date(m.created_at).getTime(),
          meta: m.meta ? JSON.parse(m.meta) : undefined,
        }));
        if (messages.length > messageCounter) messageCounter = messages.length;

        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...state.sessions[sessionId],
              messages,
            },
          },
        }));
      } catch {
        // Non-fatal — session stays with empty messages
      }
    },
  }),
);
