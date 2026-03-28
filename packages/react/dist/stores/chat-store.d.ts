import * as zustand from 'zustand';

interface ChatMessage {
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
    isOpen: boolean;
    width: number;
    activeSessionId: string;
    sessions: Record<string, SessionChatState>;
    _apiUrl: string;
    _setApiUrl: (url: string) => void;
    setOpen: (open: boolean) => void;
    toggle: () => void;
    setWidth: (width: number) => void;
    setActiveSession: (id: string) => void;
    initSession: (id: string) => void;
    removeSession: (id: string) => void;
    addMessage: (message: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => void;
    clearMessages: (sessionId?: string) => void;
    /** Returns true if this event has NOT been processed yet (and marks it). */
    markEventProcessed: (eventId: number, sessionId?: string) => boolean;
    hydrate: () => Promise<void>;
}
declare const useChatStore: zustand.UseBoundStore<zustand.StoreApi<ChatState>>;

export { type ChatMessage, useChatStore };
