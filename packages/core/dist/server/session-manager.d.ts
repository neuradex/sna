import { AgentProcess, AgentEvent } from '../core/providers/types.js';
import '../history/types.js';
import '../db/schema.js';
import 'better-sqlite3';

/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

type SessionState = "idle" | "processing" | "waiting" | "permission";
interface StartConfig {
    /**
     * Runtime — the CLI/binary we spawn (e.g. "claude-code", "codex", "opencode").
     * Dispatched via providers/index.ts getProvider(). Distinct from modelProvider:
     * the same runtime can talk to multiple model providers (e.g. OpenCode with
     * Anthropic or OpenAI backends), so this alone does not identify the LLM vendor.
     */
    provider: string;
    /**
     * Model vendor / API backend (e.g. "anthropic", "openai", "google", "oss").
     * Consumed only for attribution — stamped onto canonical rows so downstream
     * code (Langfuse tracing, UI badges, cross-provider replay) can distinguish
     * whose model produced each assistant turn.
     */
    modelProvider?: string;
    /** Model slug within the modelProvider's catalog (e.g. "sonnet-4-6", "gpt-5.4"). */
    model: string;
    permissionMode?: string;
    configDir?: string;
    /**
     * Runtime-specific CLI flags. Inherited on same-runtime restart,
     * dropped on cross-runtime restart (flags are not transferable).
     * @deprecated Prefer providerOptions; extraArgs is kept for legacy callers.
     */
    extraArgs?: string[];
    /**
     * Runtime-specific structured options. Inherited on same-runtime restart,
     * dropped on cross-runtime restart (shapes differ per runtime).
     */
    providerOptions?: Record<string, unknown>;
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
    /** Claude Code's own session ID (from system.init event). Used for --resume. */
    ccSessionId: string | null;
    createdAt: number;
    lastActivityAt: number;
}
type AgentStatus = "idle" | "busy" | "disconnected";
interface SessionInfo {
    id: string;
    label: string;
    alive: boolean;
    state: SessionState;
    agentStatus: AgentStatus;
    cwd: string;
    meta: Record<string, unknown> | null;
    config: StartConfig | null;
    ccSessionId: string | null;
    eventCount: number;
    messageCount: number;
    lastMessage: {
        actor: string;
        kind: string;
        content: string;
        created_at: string;
    } | null;
    createdAt: number;
    lastActivityAt: number;
}
interface SessionManagerOptions {
    maxSessions?: number;
}
type SessionLifecycleState = "started" | "resumed" | "killed" | "exited" | "crashed" | "restarted";
interface SessionLifecycleEvent {
    session: string;
    state: SessionLifecycleState;
    code?: number | null;
}
interface SessionConfigChangedEvent {
    session: string;
    config: StartConfig;
}
declare class SessionManager {
    private sessions;
    private maxSessions;
    private eventListeners;
    private pendingPermissions;
    private permissionRequestListeners;
    private lifecycleListeners;
    private configChangedListeners;
    private stateChangedListeners;
    private metadataChangedListeners;
    constructor(options?: SessionManagerOptions);
    /** Restore session metadata from DB (cwd, label, meta). Process state is not restored. */
    private restoreFromDb;
    /** Persist session metadata to DB. */
    private persistSession;
    /** Create a new session. Throws if session already exists or max sessions reached. */
    createSession(opts?: {
        id?: string;
        label?: string;
        cwd?: string;
        meta?: Record<string, unknown> | null;
    }): Session;
    /** Update an existing session's metadata. Throws if session not found. */
    updateSession(id: string, opts: {
        label?: string;
        meta?: Record<string, unknown> | null;
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
    setProcess(sessionId: string, proc: AgentProcess, lifecycleState?: SessionLifecycleState): void;
    /** Subscribe to real-time events for a session. Returns unsubscribe function. */
    onSessionEvent(sessionId: string, cb: (cursor: number, event: AgentEvent) => void): () => void;
    /** Push a synthetic event into a session's event stream (for user message broadcast). */
    /**
     * Push an externally-persisted event into the session.
     * The caller is responsible for DB persistence — this method only updates
     * the in-memory counter/buffer and notifies listeners.
     * eventCounter increments to stay in sync with the DB row count.
     */
    pushEvent(sessionId: string, event: AgentEvent): void;
    /** Subscribe to permission request notifications. Returns unsubscribe function. */
    onPermissionRequest(cb: (sessionId: string, request: Record<string, unknown>, createdAt: number) => void): () => void;
    /** Subscribe to session lifecycle events (started/killed/exited/crashed). Returns unsubscribe function. */
    onSessionLifecycle(cb: (event: SessionLifecycleEvent) => void): () => void;
    private emitLifecycle;
    /** Subscribe to session config changes. Returns unsubscribe function. */
    onConfigChanged(cb: (event: SessionConfigChangedEvent) => void): () => void;
    private emitConfigChanged;
    onMetadataChanged(cb: (sessionId: string) => void): () => void;
    private emitMetadataChanged;
    onStateChanged(cb: (event: {
        session: string;
        agentStatus: AgentStatus;
        state: SessionState;
    }) => void): () => void;
    /** Update session state and push agentStatus change to subscribers. */
    updateSessionState(sessionId: string, newState: SessionState): void;
    private setSessionState;
    /** Create a pending permission request. Returns a promise that resolves when approved/denied. */
    createPendingPermission(sessionId: string, request: Record<string, unknown>, opts?: {
        timeoutMs?: number;
    }): Promise<boolean>;
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
    /** Interrupt the current turn. Process stays alive, returns to waiting. */
    interruptSession(id: string): boolean;
    /** Change model. Sends control message if alive, always persists to config. */
    setSessionModel(id: string, model: string): boolean;
    /** Change permission mode. Sends control message if alive, always persists to config. */
    setSessionPermissionMode(id: string, mode: string): boolean;
    /** Kill the agent process in a session (session stays, can be restarted). */
    killSession(id: string): boolean;
    /** Remove a session entirely. Cannot remove "default". */
    removeSession(id: string): boolean;
    /** List all sessions as serializable info objects. */
    listSessions(): SessionInfo[];
    /** Touch a session's lastActivityAt timestamp. */
    touch(id: string): void;
    /** Persist an agent event to chat_messages. */
    private getMessageStats;
    /**
     * Persist an agent event to chat_messages as a canonical (actor, kind) block.
     * Returns true if a row was inserted. Streaming-only events (deltas) return
     * false so the event cursor doesn't advance for them.
     *
     * Assistant-authored blocks (text / thinking / tool_use) are stamped with
     * three-layer attribution — runtime (CLI), modelProvider (LLM API vendor),
     * and model (specific slug) — pulled from session.lastStartConfig at emit
     * time. If the user switches mid-session, subsequent rows carry the new
     * attribution. Essential for auditing, Langfuse traces, UI badges, and
     * adapters that need to know "who actually said this" when converting
     * canonical back into a provider-native format.
     *
     * Event → (actor, kind) mapping:
     *   assistant   → (assistant, text)           meta={runtime, modelProvider, model}
     *   thinking    → (assistant, thinking)       meta={runtime, modelProvider, model, signature?}
     *   tool_use    → (assistant, tool_use)       meta={runtime, modelProvider, model, id, input, name}
     *   tool_result → (system,    tool_result)    meta={toolUseId, isError}
     *   complete    → (system,    status)         meta={usage, model, ...}
     *   error       → (system,    error)          meta={status:"error"}
     */
    private persistEvent;
    /** Kill all sessions. Used during shutdown. */
    killAll(): void;
    get size(): number;
}

export { type AgentStatus, type Session, type SessionConfigChangedEvent, type SessionInfo, type SessionLifecycleEvent, type SessionLifecycleState, SessionManager, type SessionManagerOptions, type SessionState, type StartConfig };
