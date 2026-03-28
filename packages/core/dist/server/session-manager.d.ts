import { AgentProcess, AgentEvent } from '../core/providers/types.js';

/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

interface Session {
    id: string;
    process: AgentProcess | null;
    eventBuffer: AgentEvent[];
    eventCounter: number;
    label: string;
    cwd: string;
    createdAt: number;
    lastActivityAt: number;
}
interface SessionInfo {
    id: string;
    label: string;
    alive: boolean;
    cwd: string;
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
    constructor(options?: SessionManagerOptions);
    /** Create a new session. Throws if max sessions reached. */
    createSession(opts?: {
        id?: string;
        label?: string;
        cwd?: string;
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
    /** Kill the agent process in a session (session stays, can be restarted). */
    killSession(id: string): boolean;
    /** Remove a session entirely. Cannot remove "default". */
    removeSession(id: string): boolean;
    /** List all sessions as serializable info objects. */
    listSessions(): SessionInfo[];
    /** Touch a session's lastActivityAt timestamp. */
    touch(id: string): void;
    /** Kill all sessions. Used during shutdown. */
    killAll(): void;
    get size(): number;
}

export { type Session, type SessionInfo, SessionManager, type SessionManagerOptions };
