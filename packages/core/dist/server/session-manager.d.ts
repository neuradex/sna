import { AgentProcess, AgentEvent } from '../core/providers/types.js';

/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

type SessionState = "idle" | "processing" | "waiting" | "permission";
interface StartConfig {
    provider: string;
    model: string;
    permissionMode: string;
    extraArgs?: string[];
}
interface Session {
    id: string;
    process: AgentProcess | null;
    eventBuffer: AgentEvent[];
    eventCounter: number;
    label: string;
    cwd: string;
    meta: Record<string, unknown> | null;
    state: SessionState;
    lastStartConfig: StartConfig | null;
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
type SessionLifecycleState = "started" | "killed" | "exited" | "crashed" | "restarted";
interface SessionLifecycleEvent {
    session: string;
    state: SessionLifecycleState;
    code?: number | null;
}
declare class SessionManager {
    private sessions;
    private maxSessions;
    private eventListeners;
    private pendingPermissions;
    private skillEventListeners;
    private permissionRequestListeners;
    private lifecycleListeners;
    constructor(options?: SessionManagerOptions);
    /** Restore session metadata from DB (cwd, label, meta). Process state is not restored. */
    private restoreFromDb;
    /** Persist session metadata to DB. */
    private persistSession;
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
    /** Subscribe to skill events broadcast. Returns unsubscribe function. */
    onSkillEvent(cb: (event: Record<string, unknown>) => void): () => void;
    /** Broadcast a skill event to all subscribers (called after DB insert). */
    broadcastSkillEvent(event: Record<string, unknown>): void;
    /** Subscribe to permission request notifications. Returns unsubscribe function. */
    onPermissionRequest(cb: (sessionId: string, request: Record<string, unknown>, createdAt: number) => void): () => void;
    /** Subscribe to session lifecycle events (started/killed/exited/crashed). Returns unsubscribe function. */
    onSessionLifecycle(cb: (event: SessionLifecycleEvent) => void): () => void;
    private emitLifecycle;
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
    /** Save the start config for a session (called by start handlers). */
    saveStartConfig(id: string, config: StartConfig): void;
    /** Restart session: kill → re-spawn with merged config + --resume. */
    restartSession(id: string, overrides: Partial<StartConfig>, spawnFn: (config: StartConfig) => AgentProcess): {
        config: StartConfig;
    };
    /** Interrupt the current turn (SIGINT). Process stays alive, returns to waiting. */
    interruptSession(id: string): boolean;
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

export { type Session, type SessionInfo, type SessionLifecycleEvent, type SessionLifecycleState, SessionManager, type SessionManagerOptions, type SessionState, type StartConfig };
