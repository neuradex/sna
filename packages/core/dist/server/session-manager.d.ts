import { AgentProcess, AgentEvent } from '../core/providers/types.js';

/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

type SessionState = "idle" | "processing" | "waiting" | "permission";
interface Session {
    id: string;
    process: AgentProcess | null;
    eventBuffer: AgentEvent[];
    eventCounter: number;
    label: string;
    cwd: string;
    meta: Record<string, unknown> | null;
    state: SessionState;
    createdAt: number;
    lastActivityAt: number;
}
interface SessionInfo {
    id: string;
    label: string;
    alive: boolean;
    state: SessionState;
    cwd: string;
    meta: Record<string, unknown> | null;
    eventCount: number;
    createdAt: number;
    lastActivityAt: number;
}
interface SessionManagerOptions {
    maxSessions?: number;
}
declare class SessionManager {
    private sessions;
    private maxSessions;
    private eventListeners;
    private pendingPermissions;
    constructor(options?: SessionManagerOptions);
    /** Create a new session. Throws if max sessions reached. */
    createSession(opts?: {
        id?: string;
        label?: string;
        cwd?: string;
        meta?: Record<string, unknown> | null;
    }): Session;
    /** Get a session by ID. */
    getSession(id: string): Session | undefined;
    /** Get or create a session (used for "default" backward compat). */
    getOrCreateSession(id: string, opts?: {
        label?: string;
        cwd?: string;
    }): Session;
    /** Set the agent process for a session. Subscribes to events. */
    setProcess(sessionId: string, proc: AgentProcess): void;
    /** Subscribe to real-time events for a session. Returns unsubscribe function. */
    onSessionEvent(sessionId: string, cb: (cursor: number, event: AgentEvent) => void): () => void;
    /** Create a pending permission request. Returns a promise that resolves when approved/denied. */
    createPendingPermission(sessionId: string, request: Record<string, unknown>): Promise<boolean>;
    /** Resolve a pending permission request. Returns false if no pending request. */
    resolvePendingPermission(sessionId: string, approved: boolean): boolean;
    /** Get a pending permission for a specific session. */
    getPendingPermission(sessionId: string): {
        request: Record<string, unknown>;
        createdAt: number;
    } | null;
    /** Get all pending permissions across sessions. */
    getAllPendingPermissions(): Array<{
        sessionId: string;
        request: Record<string, unknown>;
        createdAt: number;
    }>;
    /** Kill the agent process in a session (session stays, can be restarted). */
    killSession(id: string): boolean;
    /** Remove a session entirely. Cannot remove "default". */
    removeSession(id: string): boolean;
    /** List all sessions as serializable info objects. */
    listSessions(): SessionInfo[];
    /** Touch a session's lastActivityAt timestamp. */
    touch(id: string): void;
    /** Persist an agent event to chat_messages. */
    private persistEvent;
    /** Kill all sessions. Used during shutdown. */
    killAll(): void;
    get size(): number;
}

export { type Session, type SessionInfo, SessionManager, type SessionManagerOptions, type SessionState };
