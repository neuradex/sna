/**
 * @module @sna-sdk/client
 *
 * Dual-transport client for the SNA (Skills-Native Application) API server.
 *
 * ## Transport model
 *
 * Configure both transports explicitly via `ws` and `http` boolean flags.
 * Both URLs are derived from a single `baseUrl` — no need to specify them separately.
 *
 * | Transport | Used for | Enabled by |
 * |-----------|----------|------------|
 * | **REST (HTTP)** | State-changing ops that need ordering guarantees | `http: true` |
 * | **WebSocket** | Real-time push, event streaming, subscriptions | `ws: true` |
 *
 * Given `baseUrl: "localhost:3099"`:
 * - WS endpoint: `ws://localhost:3099/ws`
 * - HTTP base: `http://localhost:3099`
 *
 * ## What HTTP guarantees (`http: true`)
 *
 * The following operations block until the server has **fully committed**
 * the state change before the Promise resolves:
 *
 * - `sessions.create` — DB row exists; safe to `agent.start` immediately after
 * - `sessions.update / remove` — change is committed before returning
 * - `agent.start` — the process **has been spawned** (`process.alive === true`).
 *   Note: the agent may not yet be in `"waiting"` state — the internal `init`
 *   handshake fires asynchronously after spawn. Sending a message immediately
 *   after is safe in practice (stdin queues the message), but if you need to
 *   confirm `agentStatus === "idle"` first, poll `getStatus`.
 * - `agent.send` — message written to stdin and persisted to DB before returning
 * - `agent.kill / restart / resume / interrupt` — state transition complete
 * - `agent.getStatus / setModel / setPermissionMode` — reflects current state
 *
 * ## What HTTP does NOT guarantee
 *
 * - **Agent `"waiting"` state after `start`** — process is alive but init is async.
 * - **Push delivery order** — `onEvent`, `onSnapshot`, and permission pushes
 *   arrive over WebSocket asynchronously with respect to HTTP responses.
 * - **Cross-client ordering** — only within a single `SnaClient` instance.
 *
 * ## Operations that always use WebSocket (`ws: true`)
 *
 * Regardless of `http`, these always require a WS connection:
 * - `agent.subscribe` / `unsubscribe` — server-side subscription state
 * - `agent.onEvent` — real-time event push
 * - `sessions.onSnapshot` / `onConfigChanged` — reactive session state push
 * - `agent.subscribePermissions` / `onPermissionRequest` / `respondPermission`
 *
 * @example Standard setup (both transports)
 * ```ts
 * import { SnaClient } from "@sna-sdk/client";
 *
 * const sna = new SnaClient({
 *   baseUrl: "localhost:3099",
 *   ws: true,
 *   http: true,
 * });
 *
 * sna.sessions.onSnapshot((sessions) => setSessions(sessions));
 * sna.connect();
 *
 * // Safe to chain — each HTTP response confirms the op is committed
 * const { sessionId } = await sna.sessions.create({ label: "my-task" });
 * await sna.agent.start(sessionId, { model: "claude-sonnet-4-6" });
 * await sna.agent.send(sessionId, "Hello!");
 *
 * // Event streaming always uses WS
 * sna.agent.onEvent(({ event }) => {
 *   if (event.type === "assistant") console.log(event.message);
 * });
 * await sna.agent.subscribe(sessionId);
 * ```
 *
 * @example WS-only (no ordering guarantees)
 * ```ts
 * const sna = new SnaClient({
 *   baseUrl: "localhost:3099",
 *   ws: true,
 *   http: false, // server ACKs immediately; async work may not be done
 * });
 * ```
 *
 * @example Permission handling
 * ```ts
 * sna.agent.onPermissionRequest(({ session, request }) => {
 *   showPermissionDialog(request, (approved) => {
 *     sna.agent.respondPermission(session, approved);
 *   });
 * });
 * await sna.agent.subscribePermissions();
 * ```
 */
/**
 * WebSocket connection state.
 *
 * - `"connecting"` — WebSocket is opening
 * - `"connected"` — WebSocket is open and ready for messages
 * - `"disconnected"` — WebSocket is closed (may auto-reconnect)
 */
type ConnectionStatus = "connecting" | "connected" | "disconnected";
/**
 * Options for creating an {@link SnaClient} instance.
 */
interface SnaClientOptions {
    /**
     * Base URL of the SNA server.
     *
     * Accepts a bare host or a full HTTP/HTTPS URL. The client derives
     * the WebSocket and HTTP endpoints from this value:
     * - `"localhost:3099"` → WS: `ws://localhost:3099/ws`, HTTP: `http://localhost:3099`
     * - `"https://my-server.com"` → WS: `wss://my-server.com/ws`, HTTP: `https://my-server.com`
     *
     * @example "localhost:3099"
     * @example "https://my-server.com"
     */
    baseUrl: string;
    /**
     * Enable WebSocket transport.
     *
     * When `true`, the client connects to `ws(s)://<baseUrl>/ws` for
     * real-time push operations (event streaming, session snapshots,
     * permission notifications).
     *
     * When `false`, all WS-dependent operations will reject with an error.
     * Use `false` only when building an HTTP-only integration.
     */
    ws: boolean;
    /**
     * Enable REST (HTTP) transport.
     *
     * When `true`, state-changing operations (`sessions.create/update/remove`,
     * `agent.start/send/kill/restart/resume/interrupt`, `agent.getStatus`,
     * `agent.setModel/setPermissionMode`) are routed through REST. The Promise
     * resolves only after the server has fully committed the operation.
     *
     * When `false`, all operations fall back to WebSocket (the server ACKs
     * immediately without waiting for async work to complete).
     */
    http: boolean;
    /**
     * Whether to automatically reconnect when the WebSocket connection drops.
     *
     * When `true`, the client will attempt to reconnect after
     * {@link reconnectDelay} ms, and restore all active subscriptions
     * (agent events + permissions) once reconnected.
     *
     * @default true
     */
    reconnect?: boolean;
    /**
     * Delay in milliseconds before each reconnect attempt.
     *
     * @default 2000
     */
    reconnectDelay?: number;
    /**
     * Maximum number of reconnect attempts. `0` means unlimited.
     *
     * After this many consecutive failures the client stays disconnected.
     * The counter resets on every successful connection.
     *
     * @default 0
     */
    maxReconnectAttempts?: number;
}
/**
 * A raw WebSocket message as received from the SNA server.
 *
 * Every message has a `type` field. Request responses also include `rid`
 * for correlation. Additional fields vary by message type.
 */
interface WsMessage {
    /** Message type, e.g. `"sessions.snapshot"`, `"agent.event"`, `"error"`. */
    type: string;
    /** Request ID for response correlation. Absent on server-initiated pushes. */
    rid?: string;
    /** Additional fields depend on the message type. */
    [key: string]: unknown;
}
/**
 * Dual-transport client for the SNA API server.
 *
 * Provide a single `baseUrl` and explicit `ws`/`http` flags.
 * The client derives the WS and HTTP endpoints automatically.
 *
 * @example
 * ```ts
 * const sna = new SnaClient({
 *   baseUrl: "localhost:3099",
 *   ws: true,   // real-time push, event streaming
 *   http: true, // ordering-guaranteed state changes
 * });
 * sna.connect();
 *
 * const { sessionId } = await sna.sessions.create({ label: "my-session" });
 * await sna.agent.start(sessionId, { prompt: "Hello" });
 * ```
 */
declare class SnaClient {
    private ws;
    private _status;
    private ridCounter;
    private pending;
    private pushHandlers;
    private statusListeners;
    private reconnectTimer;
    private reconnectAttempts;
    private disposed;
    private readonly wsUrl;
    private readonly _reconnect;
    private readonly reconnectDelay;
    private readonly maxReconnectAttempts;
    /** @internal Used by SessionsApi and AgentApi within this module. */
    readonly _httpUrl: string | undefined;
    /**
     * Session management APIs.
     *
     * Use this namespace to create/remove sessions and listen for
     * real-time session state snapshots.
     *
     * @see {@link SessionsApi}
     */
    readonly sessions: SessionsApi;
    /**
     * Agent control and event streaming APIs.
     *
     * Use this namespace to start/stop agents, send messages,
     * subscribe to event streams, and handle permission requests.
     *
     * @see {@link AgentApi}
     */
    readonly agent: AgentApi;
    /**
     * Skill event streaming and emission APIs.
     *
     * Use this namespace to subscribe to skill events, emit events,
     * and stream events via SSE.
     *
     * @see {@link EventsApi}
     */
    readonly events: EventsApi;
    /**
     * Chat session and message persistence APIs.
     *
     * Use this namespace to manage chat sessions and messages
     * stored in the SNA database.
     *
     * @see {@link ChatApi}
     */
    readonly chat: ChatApi;
    constructor(options: SnaClientOptions);
    /**
     * Current connection status.
     *
     * @example
     * ```ts
     * if (sna.status === "connected") {
     *   await sna.agent.send("default", "Hello");
     * }
     * ```
     */
    get status(): ConnectionStatus;
    /**
     * Shorthand for `status === "connected"`.
     *
     * @example
     * ```ts
     * await waitFor(() => sna.connected);
     * ```
     */
    get connected(): boolean;
    /**
     * Open the WebSocket connection to the SNA server.
     *
     * If already connecting or connected, this is a no-op.
     * On success, all registered {@link onConnectionStatus} callbacks
     * fire with `"connecting"` then `"connected"`.
     *
     * After connecting, the server immediately pushes a
     * `sessions.snapshot` message — register {@link sessions.onSnapshot}
     * before calling `connect()` to receive it.
     *
     * @example
     * ```ts
     * sna.sessions.onSnapshot((sessions) => setSessions(sessions));
     * sna.connect(); // snapshot arrives immediately after open
     * ```
     */
    connect(): void;
    /**
     * Close the WebSocket connection and stop reconnecting.
     *
     * All pending request Promises are rejected with `"disconnected"`.
     * To reconnect later, call {@link connect} again.
     *
     * @example
     * ```ts
     * // Clean shutdown
     * sna.disconnect();
     * ```
     */
    disconnect(): void;
    /**
     * Register a callback for connection status changes.
     *
     * The callback fires whenever the status transitions between
     * `"connecting"`, `"connected"`, and `"disconnected"`.
     *
     * @param cb - Called with the new {@link ConnectionStatus}.
     * @returns An unsubscribe function. Call it to stop receiving updates.
     *
     * @example
     * ```ts
     * const unsub = sna.onConnectionStatus((status) => {
     *   if (status === "disconnected") showReconnectBanner();
     *   if (status === "connected") hideReconnectBanner();
     * });
     *
     * // Later: stop listening
     * unsub();
     * ```
     */
    onConnectionStatus(cb: (status: ConnectionStatus) => void): () => void;
    /**
     * Send a typed request to the server and wait for the response.
     *
     * Each request is assigned a unique `rid` (request ID). The returned
     * Promise resolves when the server sends back a message with the
     * matching `rid`, or rejects if:
     * - The server responds with `type: "error"`
     * - The connection is lost before a response arrives
     * - The client is not connected
     *
     * Prefer the namespaced APIs ({@link sessions}, {@link agent}) over
     * calling `request()` directly — they provide full type safety.
     *
     * @typeParam T - Expected response shape.
     * @param type - The WS message type, e.g. `"sessions.create"`.
     * @param payload - Additional fields to include in the message.
     * @returns The server's response (excluding `type` and `rid`).
     *
     * @example
     * ```ts
     * // Prefer: sna.sessions.create({ label: "test" })
     * // Direct: sna.request("sessions.create", { label: "test" })
     * ```
     */
    request<T = Record<string, unknown>>(type: string, payload?: Record<string, unknown>): Promise<T>;
    /**
     * Register a handler for server-initiated push messages.
     *
     * Push messages are messages the server sends without a prior request
     * (no `rid`). Examples: `"sessions.snapshot"`, `"agent.event"`,
     * `"permission.request"`.
     *
     * Multiple handlers can be registered for the same type.
     * Prefer the namespaced helpers (e.g. {@link sessions.onSnapshot},
     * {@link agent.onEvent}) for type safety.
     *
     * @param type - The push message type to listen for.
     * @param handler - Called with the full message object.
     * @returns An unsubscribe function.
     *
     * @example
     * ```ts
     * const unsub = sna.onPush("session.lifecycle", (msg) => {
     *   console.log(`Session ${msg.session} → ${msg.state}`);
     * });
     * ```
     */
    onPush(type: string, handler: (msg: WsMessage) => void): () => void;
    /**
     * Perform a REST request against the SNA HTTP server.
     *
     * Used internally by {@link SessionsApi} and {@link AgentApi} when
     * {@link SnaClientOptions.httpUrl} is configured. Falls back to WS
     * if `httpUrl` is not set.
     *
     * @internal
     */
    _httpFetch<T = Record<string, unknown>>(method: string, path: string, body?: Record<string, unknown>): Promise<T>;
    /**
     * Parse an SSE response as an AsyncGenerator.
     * Yields parsed JSON objects from `data:` lines.
     * @internal
     */
    static _parseSse(response: Response): AsyncGenerator<Record<string, unknown>>;
    private doConnect;
    private setStatus;
    private rejectAllPending;
    private scheduleReconnect;
    private clearReconnectTimer;
    /** Called after reconnect — re-registers server-side subscriptions. */
    private resubscribe;
}
/**
 * Information about a single agent session.
 *
 * Received as part of the `sessions.snapshot` push or from
 * `sessions.list` responses.
 */
interface SessionInfo {
    /** Unique session identifier (e.g. `"default"`, `"abc123"`). */
    id: string;
    /** Human-readable label for the session. */
    label: string;
    /** Whether the agent process is currently running. */
    alive: boolean;
    /** Internal session state: `"idle"`, `"processing"`, `"waiting"`, `"permission"`. */
    state: string;
    /**
     * High-level agent status derived from `alive` + `state`.
     *
     * - `"idle"` — agent is running but not processing
     * - `"busy"` — agent is actively processing a request
     * - `"disconnected"` — agent process is not running
     */
    agentStatus: "idle" | "busy" | "disconnected";
    /** Working directory for this session's agent. */
    cwd: string;
    /** Arbitrary metadata attached to the session. */
    meta: Record<string, unknown> | null;
    /** The last configuration used to start/restart the agent, or `null` if never started. */
    config: {
        provider: string;
        model: string;
        permissionMode: string;
        extraArgs?: string[];
    } | null;
    /** Claude Code's internal session ID (used for `--resume`). */
    ccSessionId: string | null;
    /** Number of agent events emitted in this session. */
    eventCount: number;
    /** Number of chat messages stored in the database for this session. */
    messageCount: number;
    /** The most recent chat message, or `null` if none. */
    lastMessage: {
        role: string;
        content: string;
        created_at: string;
    } | null;
    /** Unix timestamp (ms) when the session was created. */
    createdAt: number;
    /** Unix timestamp (ms) of the last activity (message sent/received). */
    lastActivityAt: number;
}
/** Options for a one-shot agent execution. */
interface RunOnceOptions {
    message: string;
    model?: string;
    systemPrompt?: string;
    appendSystemPrompt?: string;
    permissionMode?: string;
    cwd?: string;
    timeout?: number;
    provider?: string;
    extraArgs?: string[];
}
/** Result of a one-shot agent execution. */
interface RunOnceResult {
    result: string;
    usage: Record<string, unknown> | null;
}
/** A skill event row from the database. */
interface SkillEvent {
    id: number;
    session_id: string | null;
    skill: string;
    type: string;
    message: string;
    data: string | null;
    created_at: string;
}
/** A chat session row from the database. */
interface ChatSession {
    id: string;
    label: string;
    type: string;
    meta: Record<string, unknown> | null;
    cwd: string | null;
    created_at: string;
}
/** A chat message row from the database. */
interface ChatMessage {
    id: number;
    session_id: string;
    role: string;
    content: string;
    skill_name: string | null;
    meta: Record<string, unknown> | null;
    created_at: string;
}
/**
 * Session management APIs.
 *
 * Access via `sna.sessions`.
 *
 * ## Transport and ordering
 *
 * When `httpUrl` is configured on {@link SnaClient}, mutating operations
 * (`create`, `update`, `remove`) are routed through REST. The Promise
 * resolves only after the server has **fully committed** the change to the
 * database, so it is safe to call `agent.start` immediately after `create`
 * without any race condition.
 *
 * Without `httpUrl`, these operations go through WebSocket. The server
 * acknowledges the request as soon as it is received — the async DB write
 * may not yet be complete when the Promise resolves.
 *
 * Reactive operations (`onSnapshot`, `onConfigChanged`) always use
 * WebSocket push and are unaffected by the `httpUrl` setting.
 *
 * @example
 * ```ts
 * // Reactive snapshots (always WS)
 * sna.sessions.onSnapshot((sessions) => {
 *   const active = sessions.filter(s => s.alive);
 *   console.log(`${active.length} active sessions`);
 * });
 *
 * // Create — with httpUrl, DB write is committed before Promise resolves
 * const { sessionId } = await sna.sessions.create({ label: "my-task" });
 * // Safe to start agent immediately
 * await sna.agent.start(sessionId, { prompt: "Go!" });
 * ```
 */
declare class SessionsApi {
    private client;
    private snapshotUnsub;
    constructor(client: SnaClient);
    /**
     * List all sessions on the server.
     *
     * Returns a point-in-time snapshot of all sessions. For live
     * updates, use {@link onSnapshot} instead.
     *
     * @example
     * ```ts
     * const { sessions } = await sna.sessions.list();
     * console.log(sessions.map(s => s.id));
     * ```
     */
    list(): Promise<{
        sessions: SessionInfo[];
    }>;
    /**
     * Create a new agent session on the server.
     *
     * The session is created in a stopped state — call
     * {@link AgentApi.start | sna.agent.start()} to spawn an agent in it.
     *
     * **Ordering guarantee (REST):** when `httpUrl` is configured, the Promise
     * resolves only after the session row is committed to the database. It is
     * safe to call `agent.start` on the returned `sessionId` immediately.
     *
     * **Without `httpUrl` (WS fallback):** the server ACKs on receipt; the DB
     * write is async and may not be complete when the Promise resolves.
     *
     * @param opts - Session options.
     * @param opts.id - Explicit session ID. Auto-generated if omitted.
     * @param opts.label - Human-readable label.
     * @param opts.cwd - Working directory for the agent. Defaults to server's cwd.
     * @param opts.meta - Arbitrary metadata to attach.
     * @returns The created session's ID, label, and metadata.
     *
     * @example
     * ```ts
     * const { sessionId } = await sna.sessions.create({
     *   label: "form-fill",
     *   cwd: "/path/to/project",
     * });
     * // With httpUrl: session is in DB — safe to start immediately
     * await sna.agent.start(sessionId, { prompt: "Fill the form" });
     * ```
     */
    create(opts?: {
        id?: string;
        label?: string;
        cwd?: string;
        meta?: Record<string, unknown>;
    }): Promise<{
        status: "created";
        sessionId: string;
        label: string;
        meta: Record<string, unknown> | null;
    }>;
    /**
     * Remove a session from the server.
     *
     * The agent process (if running) is killed before removal.
     * The `"default"` session cannot be removed.
     *
     * **Ordering guarantee (REST):** when `httpUrl` is configured, the session
     * and its process are fully torn down before the Promise resolves.
     *
     * @param session - The session ID to remove.
     *
     * @example
     * ```ts
     * await sna.sessions.remove("temp-session");
     * ```
     */
    remove(session: string): Promise<{
        status: "removed";
    }>;
    /**
     * Update an existing session's metadata.
     *
     * Only the provided fields are patched — omitted fields remain unchanged.
     * After a successful update, the server pushes a `sessions.snapshot`
     * to all connected clients automatically.
     *
     * **Ordering guarantee (REST):** when `httpUrl` is configured, the metadata
     * update is committed to the database before the Promise resolves.
     *
     * @param session - The session ID to update.
     * @param opts - Fields to update. All optional.
     * @param opts.label - New human-readable label.
     * @param opts.meta - New metadata (replaces entirely, not merged).
     * @param opts.cwd - New working directory.
     * @returns The updated session ID.
     * @throws If the session does not exist.
     *
     * @example
     * ```ts
     * await sna.sessions.update("my-session", {
     *   label: "Renamed session",
     *   meta: { priority: "high" },
     * });
     * ```
     */
    update(session: string, opts: {
        label?: string;
        meta?: Record<string, unknown>;
        cwd?: string;
    }): Promise<{
        status: "updated";
        session: string;
    }>;
    /**
     * Subscribe to full session state snapshots.
     *
     * The server pushes a `sessions.snapshot` message:
     * 1. **Immediately on WebSocket connection** — initial state
     * 2. **On every session lifecycle change** — started, killed, exited, crashed
     * 3. **On every agent status change** — idle, busy, disconnected
     *
     * Each snapshot contains the **complete** list of sessions.
     * Replace your local state entirely on each callback — no diffing needed.
     *
     * @param cb - Called with the full array of {@link SessionInfo} on every snapshot.
     * @returns An unsubscribe function. Call it to stop receiving snapshots.
     *
     * @example
     * ```ts
     * // In a React component (via useEffect or similar)
     * const unsub = sna.sessions.onSnapshot((sessions) => {
     *   setSessions(sessions);
     * });
     * // Cleanup
     * return () => unsub();
     * ```
     */
    onSnapshot(cb: (sessions: SessionInfo[]) => void): () => void;
    /**
     * Listen for session configuration changes.
     *
     * Fires when a session's model, permission mode, or other config
     * is updated via {@link AgentApi.setModel} or {@link AgentApi.setPermissionMode}.
     *
     * @param cb - Called with the change event.
     * @returns An unsubscribe function.
     *
     * @example
     * ```ts
     * sna.sessions.onConfigChanged(({ session, ...config }) => {
     *   console.log(`Session ${session} config updated:`, config);
     * });
     * ```
     */
    onConfigChanged(cb: (event: {
        session: string;
        [key: string]: unknown;
    }) => void): () => void;
}
/**
 * Configuration for starting or restarting an agent.
 */
interface AgentStartConfig {
    /** Agent provider name (e.g. `"claude-code"`). */
    provider?: string;
    /** Initial prompt to send to the agent on startup. */
    prompt?: string;
    /** Model to use (e.g. `"claude-sonnet-4-6"`, `"claude-opus-4-6"`). */
    model?: string;
    /** Permission mode: `"acceptEdits"`, `"bypassPermissions"`, etc. */
    permissionMode?: string;
    /**
     * Override CLAUDE_CONFIG_DIR for this session.
     * Isolates Claude config (permissions, theme, API keys, etc.) per agent.
     * Useful for running multiple agents with different permission profiles.
     */
    configDir?: string;
    /** If `true`, kill the existing agent and start fresh. */
    force?: boolean;
    /** Arbitrary metadata to attach to the agent invocation. */
    meta?: Record<string, unknown>;
    /** Extra CLI arguments passed to the agent process. */
    extraArgs?: string[];
    /** Working directory override for this agent. */
    cwd?: string;
    /** Conversation history to resume from. */
    history?: unknown[];
}
/**
 * Agent control, event streaming, and permission handling APIs.
 *
 * Access via `sna.agent`.
 *
 * This namespace covers the full agent lifecycle:
 * 1. **Start/stop** — {@link start}, {@link kill}, {@link restart}, {@link interrupt}
 * 2. **Communication** — {@link send}, {@link resume}
 * 3. **Status** — {@link getStatus}, {@link setModel}, {@link setPermissionMode}
 * 4. **Event streaming** — {@link subscribe}, {@link unsubscribe}, {@link onEvent}
 * 5. **Permissions** — {@link subscribePermissions}, {@link onPermissionRequest}, {@link respondPermission}
 *
 * ## Transport and ordering
 *
 * When `httpUrl` is configured on {@link SnaClient}, lifecycle operations
 * (`start`, `send`, `kill`, `restart`, `resume`, `interrupt`, `getStatus`,
 * `setModel`, `setPermissionMode`) are routed through REST. Each call blocks
 * until the server has fully applied the operation.
 *
 * **Important caveat for `start`:** the REST response confirms the agent
 * process has been spawned (`process.alive === true`), but the agent's
 * internal init handshake is asynchronous. The agent transitions to
 * `"waiting"` state when its `init` event fires, which may be a few
 * milliseconds after `start` resolves. Calling `send` immediately after
 * `start` is safe in practice (the message queues in the process stdin),
 * but if you need to confirm the agent is ready before sending, subscribe
 * to events and wait for `agentStatus === "idle"` via `getStatus`.
 *
 * Event streaming operations (`subscribe`, `unsubscribe`, `onEvent`) and
 * the permission flow always use WebSocket regardless of `httpUrl`.
 *
 * @example Full lifecycle (with httpUrl for ordering)
 * ```ts
 * // State-changing ops use REST → ordering guaranteed
 * await sna.agent.start("default", {
 *   prompt: "Analyze this codebase",
 *   model: "claude-sonnet-4-6",
 * });
 *
 * // Event streaming always uses WS
 * sna.agent.onEvent(({ session, event }) => {
 *   switch (event.type) {
 *     case "thinking":   console.log("[thinking]", event.message); break;
 *     case "assistant":  console.log("[reply]", event.message);    break;
 *     case "complete":   console.log("Done!");                     break;
 *   }
 * });
 * await sna.agent.subscribe("default", { since: 0 });
 *
 * // send is safe immediately after start (process is alive)
 * await sna.agent.send("default", "Now fix the bug you found");
 * ```
 */
declare class AgentApi {
    private client;
    private subscribedSessions;
    private permissionSubscribed;
    constructor(client: SnaClient);
    /**
     * Start an agent process in the given session.
     *
     * If the session doesn't exist, it's auto-created.
     * If an agent is already running and `force` is not set,
     * returns `"already_running"` without spawning a new process.
     *
     * **Ordering guarantee (REST):** when `httpUrl` is configured, the Promise
     * resolves after the agent process has been spawned (`process.alive === true`).
     * It is safe to call `send` immediately after this.
     *
     * **Not guaranteed:** the agent may not yet be in `"waiting"` state when
     * this resolves. The internal `init` handshake fires asynchronously after
     * spawn. In practice `send` succeeds because the message queues in stdin,
     * but if your code requires `agentStatus === "idle"` first, poll `getStatus`
     * or subscribe to events and await the first non-processing state.
     *
     * @param session - Target session ID.
     * @param config - Agent configuration.
     * @returns Status and the session ID the agent was started in.
     *
     * @example
     * ```ts
     * const { status } = await sna.agent.start("default", {
     *   prompt: "Hello, Claude!",
     *   model: "claude-sonnet-4-6",
     *   permissionMode: "acceptEdits",
     * });
     * console.log(status); // "started" or "already_running"
     * ```
     */
    start(session: string, config?: AgentStartConfig): Promise<{
        status: "started" | "already_running";
        provider: string;
        sessionId: string;
    }>;
    /**
     * Send a message to a running agent.
     *
     * The agent must already be started in this session.
     * Supports text messages and images.
     *
     * **Ordering guarantee (REST):** when `httpUrl` is configured, the message
     * has been written to the process stdin and persisted to the database before
     * the Promise resolves. The next `send` call will not interleave with this one.
     *
     * **Without `httpUrl` (WS fallback):** the server ACKs on receipt; the stdin
     * write and DB insert are async.
     *
     * @param session - Target session ID.
     * @param message - The text message to send.
     * @param opts - Optional images and metadata.
     *
     * @example
     * ```ts
     * await sna.agent.send("default", "Please refactor this function");
     *
     * // With an image
     * await sna.agent.send("default", "What's in this screenshot?", {
     *   images: [{ base64: "...", mimeType: "image/png" }],
     * });
     * ```
     */
    send(session: string, message: string, opts?: {
        /** Images to include with the message. */
        images?: Array<{
            base64: string;
            mimeType: string;
        }>;
        /** Arbitrary metadata attached to this message. */
        meta?: Record<string, unknown>;
    }): Promise<{
        status: "sent";
    }>;
    /**
     * Kill the agent process in a session.
     *
     * The session itself remains — only the agent process is terminated.
     * Returns `"no_session"` if the session doesn't exist.
     *
     * @param session - Target session ID.
     *
     * @example
     * ```ts
     * await sna.agent.kill("default");
     * ```
     */
    kill(session: string): Promise<{
        status: "killed" | "no_session";
    }>;
    /**
     * Restart the agent in a session.
     *
     * Kills the current agent and starts a new one, optionally with
     * updated configuration. The new agent resumes from the same
     * Claude Code session ID (via `--resume`).
     *
     * @param session - Target session ID.
     * @param config - Optional config overrides for the restarted agent.
     *
     * @example
     * ```ts
     * // Restart with a different model
     * await sna.agent.restart("default", { model: "claude-opus-4-6" });
     * ```
     */
    restart(session: string, config?: Partial<AgentStartConfig>): Promise<{
        status: "restarted";
        provider: string;
        sessionId: string;
    }>;
    /**
     * Interrupt the agent's current operation.
     *
     * Sends a SIGINT-like signal to the agent process. The agent
     * stops its current task but remains running and can receive
     * new messages.
     *
     * @param session - Target session ID.
     *
     * @example
     * ```ts
     * // Agent is taking too long — interrupt it
     * await sna.agent.interrupt("default");
     * await sna.agent.send("default", "Try a simpler approach");
     * ```
     */
    interrupt(session: string): Promise<{
        status: "interrupted" | "no_session";
    }>;
    /**
     * Resume an agent from its persisted conversation history.
     *
     * Starts a new agent process and feeds it the conversation history
     * stored in the database for this session. Useful for recovering
     * from crashes or continuing after a server restart.
     *
     * @param session - Target session ID.
     * @param opts - Optional overrides for the resumed agent.
     * @returns Status and the number of history messages loaded.
     *
     * @example
     * ```ts
     * const { historyCount } = await sna.agent.resume("default");
     * console.log(`Resumed with ${historyCount} messages`);
     * ```
     */
    resume(session: string, opts?: {
        provider?: string;
        model?: string;
        permissionMode?: string;
        configDir?: string;
        prompt?: string;
        extraArgs?: string[];
    }): Promise<{
        status: "resumed";
        provider: string;
        sessionId: string;
        historyCount: number;
    }>;
    /**
     * Get the current status of an agent session.
     *
     * Returns whether the agent is alive, its current status,
     * event/message counts, and the last start configuration.
     *
     * @param session - Target session ID.
     *
     * @example
     * ```ts
     * const status = await sna.agent.getStatus("default");
     * if (status.alive && status.agentStatus === "idle") {
     *   await sna.agent.send("default", "Next task...");
     * }
     * ```
     */
    getStatus(session: string): Promise<{
        /** Whether the agent process is running. */
        alive: boolean;
        /** High-level status: `"idle"`, `"busy"`, or `"disconnected"`. */
        agentStatus: "idle" | "busy" | "disconnected";
        /** The agent provider's internal session ID. */
        sessionId: string | null;
        /** Claude Code's session ID (for `--resume`). */
        ccSessionId: string | null;
        /** Number of events emitted so far. */
        eventCount: number;
        /** Number of messages stored in the database. */
        messageCount: number;
        /** The most recent message, or `null`. */
        lastMessage: {
            role: string;
            content: string;
            created_at: string;
        } | null;
        /** Last start configuration, or `null` if never started. */
        config: {
            provider: string;
            model: string;
            permissionMode: string;
            extraArgs?: string[];
        } | null;
    }>;
    /**
     * Run a one-shot agent task and return the result.
     *
     * Creates a temporary session, spawns an agent, waits for it to
     * complete, then cleans up. The session is deleted after execution.
     *
     * **Always synchronous from the caller's perspective** — the Promise
     * resolves only when the agent emits a `complete` event or the
     * `timeout` is reached.
     *
     * @param opts - One-shot execution options.
     * @param opts.message - The prompt to send to the agent.
     * @param opts.timeout - Max wait time in ms. Server default if omitted.
     * @returns The agent's final text response and token usage.
     *
     * @example
     * ```ts
     * const { result } = await sna.agent.runOnce({
     *   message: "What is 2 + 2?",
     *   model: "claude-haiku-4-5-20251001",
     *   timeout: 30000,
     * });
     * console.log(result); // "4"
     * ```
     */
    runOnce(opts: RunOnceOptions): Promise<RunOnceResult>;
    /**
     * Stream agent events for a session via SSE (HTTP-only).
     *
     * Returns an `AsyncIterable` of agent events. The stream stays
     * open until the caller breaks the loop or the connection is closed.
     *
     * **Requires `http: true`** — this method uses the HTTP SSE endpoint
     * (`GET /agent/events`), not WebSocket. For WS-based streaming, use
     * {@link subscribe} + {@link onEvent} instead.
     *
     * @param session - Session to stream events for.
     * @param since - Start from this event cursor. Defaults to current cursor.
     * @returns An `AsyncIterable` of agent event objects.
     * @throws If `http` transport is not enabled.
     *
     * @example
     * ```ts
     * for await (const event of sna.agent.streamEvents("default")) {
     *   if (event.type === "complete") break;
     *   console.log(event.type, event.message);
     * }
     * ```
     */
    streamEvents(session: string, since?: number): AsyncGenerator<Record<string, unknown>>;
    /**
     * Change the model for a running agent session.
     *
     * Takes effect on the next agent invocation within the session.
     *
     * @param session - Target session ID.
     * @param model - New model name (e.g. `"claude-opus-4-6"`).
     *
     * @example
     * ```ts
     * await sna.agent.setModel("default", "claude-opus-4-6");
     * ```
     */
    setModel(session: string, model: string): Promise<{
        status: "updated" | "no_session";
        model: string;
    }>;
    /**
     * Change the permission mode for a running agent session.
     *
     * @param session - Target session ID.
     * @param permissionMode - New permission mode (e.g. `"bypassPermissions"`).
     *
     * @example
     * ```ts
     * await sna.agent.setPermissionMode("default", "bypassPermissions");
     * ```
     */
    setPermissionMode(session: string, permissionMode: string): Promise<{
        status: "updated" | "no_session";
        permissionMode: string;
    }>;
    /**
     * Subscribe to real-time agent events for a session.
     *
     * After subscribing, `agent.event` push messages are delivered
     * to handlers registered via {@link onEvent}.
     *
     * **Always uses WebSocket**, regardless of whether `httpUrl` is configured.
     * Subscriptions survive reconnects — the client automatically
     * re-subscribes after a connection drop.
     *
     * @param session - Target session ID.
     * @param opts - Subscription options.
     * @param opts.since - Start from this event cursor. `0` = from the beginning.
     * @param opts.includeHistory - If `true`, replay DB-persisted history as events.
     * @returns The current cursor position.
     *
     * @example
     * ```ts
     * // Subscribe to all events from the beginning
     * sna.agent.onEvent(({ event }) => console.log(event));
     * const { cursor } = await sna.agent.subscribe("default", {
     *   since: 0,
     *   includeHistory: true,
     * });
     * console.log(`Subscribed, cursor at ${cursor}`);
     * ```
     */
    subscribe(session: string, opts?: {
        since?: number;
        includeHistory?: boolean;
    }): Promise<{
        cursor: number;
    }>;
    /**
     * Unsubscribe from agent events for a session.
     *
     * Stops receiving `agent.event` pushes for this session.
     * Also removes the session from auto-resubscribe on reconnect.
     *
     * @param session - Target session ID.
     *
     * @example
     * ```ts
     * await sna.agent.unsubscribe("default");
     * ```
     */
    unsubscribe(session: string): Promise<void>;
    /**
     * Listen to agent events across all subscribed sessions.
     *
     * Events are delivered in real-time as the agent works.
     * **Always uses WebSocket push**, regardless of `httpUrl`.
     * You must call {@link subscribe} first for the session(s) you
     * want to receive events from.
     *
     * Common event types:
     * - `"thinking"` — agent's internal reasoning
     * - `"assistant"` — agent's visible response text
     * - `"assistant_delta"` — streaming text fragment
     * - `"tool_use"` — agent is calling a tool
     * - `"tool_result"` — tool execution result
     * - `"complete"` — agent finished processing
     * - `"error"` — agent encountered an error
     * - `"user_message"` — echoed user message (for multi-client sync)
     *
     * @param cb - Called for each event.
     * @returns An unsubscribe function.
     *
     * @example
     * ```ts
     * const unsub = sna.agent.onEvent(({ session, cursor, event, isHistory }) => {
     *   if (isHistory) return; // Skip replayed history
     *
     *   switch (event.type) {
     *     case "assistant_delta":
     *       appendToChat(event.message);
     *       break;
     *     case "tool_use":
     *       showToolCall(event.data?.toolName, event.data?.input);
     *       break;
     *     case "complete":
     *       markDone();
     *       break;
     *   }
     * });
     *
     * // Cleanup
     * unsub();
     * ```
     */
    onEvent(cb: (event: {
        /** Session ID that emitted the event. */
        session: string;
        /** Monotonically increasing event cursor for ordering. */
        cursor: number;
        /** The event payload. Check `event.type` to determine the shape. */
        event: Record<string, unknown>;
        /** `true` if this event is a replayed history entry, not a live event. */
        isHistory?: boolean;
    }) => void): () => void;
    /**
     * Subscribe to permission request pushes from agents.
     *
     * When an agent needs approval (e.g. to run a Bash command or edit
     * a file), the server pushes a `permission.request` message.
     * Register {@link onPermissionRequest} before calling this to
     * receive them.
     *
     * Existing pending permissions are replayed immediately after
     * subscribing (marked with `isHistory: true`).
     *
     * The subscription survives reconnects — it's automatically
     * restored after a connection drop.
     *
     * @returns The number of currently pending permission requests.
     *
     * @example
     * ```ts
     * sna.agent.onPermissionRequest(({ session, request }) => {
     *   showApprovalDialog(request);
     * });
     * const { pendingCount } = await sna.agent.subscribePermissions();
     * console.log(`${pendingCount} permissions waiting`);
     * ```
     */
    subscribePermissions(): Promise<{
        pendingCount: number;
    }>;
    /**
     * Unsubscribe from permission request pushes.
     *
     * Stops receiving `permission.request` messages and removes
     * the subscription from auto-resubscribe on reconnect.
     *
     * @example
     * ```ts
     * await sna.agent.unsubscribePermissions();
     * ```
     */
    unsubscribePermissions(): Promise<void>;
    /**
     * Approve or deny an agent's pending permission request.
     *
     * Call this in response to a `permission.request` push received
     * via {@link onPermissionRequest}.
     *
     * @param session - The session ID that requested permission.
     * @param approved - `true` to approve, `false` to deny.
     *
     * @example
     * ```ts
     * sna.agent.onPermissionRequest(({ session, request }) => {
     *   const safe = request.tool !== "Bash"; // Simple policy
     *   sna.agent.respondPermission(session, safe);
     * });
     * ```
     */
    respondPermission(session: string, approved: boolean): Promise<{
        status: "approved" | "denied";
    }>;
    /**
     * Get all currently pending permission requests.
     *
     * Useful for showing pending approvals in a UI on initial load,
     * before subscribing to live pushes.
     *
     * @param session - Optional session filter. Omit to get all sessions.
     *
     * @example
     * ```ts
     * const { pending } = await sna.agent.getPendingPermissions();
     * for (const p of pending) {
     *   console.log(`${p.sessionId}: ${JSON.stringify(p.request)}`);
     * }
     * ```
     */
    getPendingPermissions(session?: string): Promise<{
        pending: Array<{
            /** The session that requested permission. */
            sessionId: string;
            /** The permission request details (tool name, arguments, etc.). */
            request: Record<string, unknown>;
            /** Unix timestamp (ms) when the request was created. */
            createdAt: number;
        }>;
    }>;
    /**
     * Listen for permission requests from agents.
     *
     * Fires when any agent in any subscribed session needs approval
     * to perform an action. Call {@link subscribePermissions} first.
     *
     * Use {@link respondPermission} to approve or deny the request.
     *
     * @param cb - Called for each permission request.
     * @returns An unsubscribe function.
     *
     * @example
     * ```ts
     * const unsub = sna.agent.onPermissionRequest(({ session, request, createdAt }) => {
     *   console.log(`[${session}] Wants to: ${request.tool}(${JSON.stringify(request.input)})`);
     *   // Auto-approve edits, ask user for everything else
     *   if (request.tool === "Edit") {
     *     sna.agent.respondPermission(session, true);
     *   } else {
     *     promptUser(session, request);
     *   }
     * });
     * ```
     */
    onPermissionRequest(cb: (event: {
        /** The session that requested permission. */
        session: string;
        /** The permission request details. */
        request: Record<string, unknown>;
        /** Unix timestamp (ms) when the request was created. */
        createdAt: number;
        /** `true` if this is a replayed pending request, not a new one. */
        isHistory?: boolean;
    }) => void): () => void;
    /** @internal Re-subscribe after reconnect — called automatically by SnaClient. */
    _resubscribe(): void;
}
/**
 * Skill event streaming and emission APIs.
 *
 * Access via `sna.events`.
 *
 * Skill events are lightweight records written to the `skill_events`
 * SQLite table by skills (via `emit.js`) or by calling {@link emit}.
 * They are separate from agent events (which are model output events).
 *
 * @example
 * ```ts
 * // Subscribe to real-time skill events via WebSocket
 * sna.events.onSkillEvent(({ skill, type, message }) => {
 *   console.log(`[${skill}/${type}] ${message}`);
 * });
 * await sna.events.subscribe();
 * ```
 */
declare class EventsApi {
    private client;
    constructor(client: SnaClient);
    /**
     * Subscribe to skill event pushes via WebSocket.
     *
     * After subscribing, `skill.event` push messages are delivered
     * to handlers registered via {@link onSkillEvent}.
     *
     * @param opts.since - Start from this event ID. Defaults to the latest.
     * @returns The last event ID at subscription time.
     *
     * @example
     * ```ts
     * sna.events.onSkillEvent((e) => console.log(e));
     * const { lastId } = await sna.events.subscribe({ since: 0 });
     * ```
     */
    subscribe(opts?: {
        since?: number;
    }): Promise<{
        lastId: number;
    }>;
    /**
     * Unsubscribe from skill event pushes.
     *
     * @example
     * ```ts
     * await sna.events.unsubscribe();
     * ```
     */
    unsubscribe(): Promise<void>;
    /**
     * Emit a skill event.
     *
     * Writes the event to the `skill_events` table and broadcasts it
     * to all connected WS subscribers.
     *
     * **Transport note:** WS uses `eventType` (not `type`) for this call
     * because `type` is reserved as the WS protocol routing field.
     * The client handles this automatically.
     *
     * @returns The assigned event row ID.
     *
     * @example
     * ```ts
     * await sna.events.emit({
     *   skill: "my-skill",
     *   eventType: "milestone",
     *   message: "Step 1 complete",
     *   session: "default",
     * });
     * ```
     */
    emit(opts: {
        skill: string;
        eventType: string;
        message: string;
        data?: string;
        session?: string;
    }): Promise<{
        id: number;
    }>;
    /**
     * Listen for skill event pushes.
     *
     * Fires when any skill event is pushed to this connection after
     * calling {@link subscribe}.
     *
     * @param cb - Called for each skill event.
     * @returns An unsubscribe function.
     *
     * @example
     * ```ts
     * const unsub = sna.events.onSkillEvent(({ skill, type, message }) => {
     *   if (type === "complete") markDone(skill);
     * });
     * ```
     */
    onSkillEvent(cb: (event: SkillEvent) => void): () => void;
    /**
     * Stream skill events via SSE (HTTP-only).
     *
     * Returns an `AsyncIterable` of {@link SkillEvent} rows.
     * Requires `http: true`. For WS streaming, use
     * {@link subscribe} + {@link onSkillEvent}.
     *
     * @param since - Start from this event ID.
     *
     * @example
     * ```ts
     * for await (const event of sna.events.stream()) {
     *   if (event.type === "complete") break;
     *   console.log(event.skill, event.message);
     * }
     * ```
     */
    stream(since?: number): AsyncGenerator<SkillEvent>;
}
/**
 * Chat session and message persistence APIs.
 *
 * Access via `sna.chat`.
 *
 * Chat sessions and messages are stored in the `chat_sessions` and
 * `chat_messages` SQLite tables. These are separate from agent sessions
 * (which run processes) — chat sessions are lightweight records for
 * persisting conversation history.
 *
 * @example
 * ```ts
 * const { id } = await sna.chat.createSession({ label: "My chat" });
 * await sna.chat.createMessage(id, { role: "user", content: "Hello" });
 * const { messages } = await sna.chat.listMessages(id);
 * ```
 */
declare class ChatApi {
    private client;
    constructor(client: SnaClient);
    /**
     * List all chat sessions.
     *
     * @example
     * ```ts
     * const { sessions } = await sna.chat.listSessions();
     * ```
     */
    listSessions(): Promise<{
        sessions: ChatSession[];
    }>;
    /**
     * Create a chat session.
     *
     * @param opts.id - Explicit ID. Auto-generated if omitted.
     * @param opts.label - Human-readable label.
     * @param opts.type - Session type. Defaults to `"background"`.
     * @param opts.meta - Arbitrary metadata.
     *
     * @example
     * ```ts
     * const { id } = await sna.chat.createSession({ label: "thread-1" });
     * ```
     */
    createSession(opts?: {
        id?: string;
        label?: string;
        type?: string;
        meta?: Record<string, unknown>;
    }): Promise<{
        status: "created";
        id: string;
        meta: Record<string, unknown> | null;
    }>;
    /**
     * Delete a chat session and all its messages.
     *
     * @param session - The session ID to delete.
     *
     * @example
     * ```ts
     * await sna.chat.removeSession("thread-1");
     * ```
     */
    removeSession(session: string): Promise<{
        status: "deleted";
    }>;
    /**
     * List messages for a chat session.
     *
     * @param session - The session ID.
     * @param opts.since - Only return messages with `id > since`.
     *
     * @example
     * ```ts
     * const { messages } = await sna.chat.listMessages("thread-1");
     * const newOnly = await sna.chat.listMessages("thread-1", { since: lastId });
     * ```
     */
    listMessages(session: string, opts?: {
        since?: number;
    }): Promise<{
        messages: ChatMessage[];
    }>;
    /**
     * Add a message to a chat session.
     *
     * The session is auto-created with type `"main"` if it doesn't exist.
     *
     * @param session - The session ID.
     * @param opts.role - Message role: `"user"`, `"assistant"`, `"thinking"`, etc.
     * @param opts.content - Message text.
     * @param opts.skill_name - Skill that generated this message, if any.
     * @param opts.meta - Arbitrary metadata.
     * @returns The assigned message row ID.
     *
     * @example
     * ```ts
     * const { id } = await sna.chat.createMessage("thread-1", {
     *   role: "user",
     *   content: "What is the capital of France?",
     * });
     * ```
     */
    createMessage(session: string, opts: {
        role: string;
        content?: string;
        skill_name?: string;
        meta?: Record<string, unknown>;
    }): Promise<{
        status: "created";
        id: number;
    }>;
    /**
     * Clear all messages for a chat session.
     *
     * @param session - The session ID.
     *
     * @example
     * ```ts
     * await sna.chat.clearMessages("thread-1");
     * ```
     */
    clearMessages(session: string): Promise<{
        status: "cleared";
    }>;
}

export { type AgentStartConfig, type ConnectionStatus, type SessionInfo, SnaClient, type SnaClientOptions, type WsMessage };
