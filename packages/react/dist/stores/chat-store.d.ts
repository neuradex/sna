import * as zustand_middleware from 'zustand/middleware';
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
}
declare const useChatStore: zustand.UseBoundStore<Omit<zustand.StoreApi<ChatState>, "setState" | "persist"> & {
    setState(partial: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>), replace?: false | undefined): unknown;
    setState(state: ChatState | ((state: ChatState) => ChatState), replace: true): unknown;
    persist: {
        setOptions: (options: Partial<zustand_middleware.PersistOptions<ChatState, {
            isOpen: boolean;
            width: number;
            activeSessionId: string;
            sessions: {
                [k: string]: {
                    messages: ChatMessage[];
                    processedEventIds: number[];
                };
            };
        }, unknown>>) => void;
        clearStorage: () => void;
        rehydrate: () => Promise<void> | void;
        hasHydrated: () => boolean;
        onHydrate: (fn: (state: ChatState) => void) => () => void;
        onFinishHydration: (fn: (state: ChatState) => void) => () => void;
        getOptions: () => Partial<zustand_middleware.PersistOptions<ChatState, {
            isOpen: boolean;
            width: number;
            activeSessionId: string;
            sessions: {
                [k: string]: {
                    messages: ChatMessage[];
                    processedEventIds: number[];
                };
            };
        }, unknown>>;
    };
}>;

export { type ChatMessage, useChatStore };
