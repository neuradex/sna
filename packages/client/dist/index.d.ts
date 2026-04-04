/**
 * @module @sna-sdk/client
 *
 * Typed WebSocket client for the SNA (Skills-Native Application) API server.
 *
 * This is the primary interface for browser and Node.js apps to communicate
 * with the SNA server. It handles:
 *
 * - **Connection lifecycle** — connect, disconnect, auto-reconnect
 * - **Request/response correlation** — every request gets a unique `rid`;
 *   the matching response resolves the returned Promise
 * - **Push message routing** — server-initiated messages are dispatched
 *   to registered handlers by message type
 * - **Auto re-subscription** — after a reconnect, active agent event
 *   subscriptions and permission subscriptions are automatically restored
 *
 * All APIs are namespaced under {@link SnaClient.sessions} and
 * {@link SnaClient.agent} for discoverability.
 *
 * @example Basic usage
 * ```ts
 * import { SnaClient } from "@sna-sdk/client";
 *
 * const sna = new SnaClient({ url: "ws://localhost:3099/ws" });
 *
 * // Monitor connection state
 * sna.onConnectionStatus((status) => console.log("SNA:", status));
 *
 * // Receive live session snapshots (pushed automatically)
 * sna.sessions.onSnapshot((sessions) => {
 *   console.log("Sessions:", sessions);
 * });
 *
 * // Connect — snapshot arrives immediately
 * sna.connect();
 *
 * // Start an agent and subscribe to its events
 * await sna.agent.start("default", { prompt: "Hello!" });
 * sna.agent.onEvent(({ session, event }) => {
 *   if (event.type === "assistant") console.log(event.message);
 * });
 * await sna.agent.subscribe("default", { since: 0 });
 * ```
 *
 * @example Permission handling
 * ```ts
 * sna.agent.onPermissionRequest(({ session, request }) => {
 *   // Show UI to approve/deny
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
     * Full WebSocket URL of the SNA API server.
     *
     * @example "ws://localhost:3099/ws"
     */
    url: string;
    /**
     * Whether to automatically reconnect when the connection drops.
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
 * Typed WebSocket client for the SNA API server.
 *
 * Create one instance per app, call {@link connect} to open the WebSocket,
 * and use the namespaced APIs to interact with the server.
 *
 * @example
 * ```ts
 * const sna = new SnaClient({ url: "ws://localhost:3099/ws" });
 * sna.connect();
 *
 * // Use namespaced APIs
 * await sna.sessions.create({ label: "my-session" });
 * await sna.agent.start("my-session", { prompt: "Hello" });
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
    private readonly url;
    private readonly _reconnect;
    private readonly reconnectDelay;
    private readonly maxReconnectAttempts;
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
/**
 * Session management APIs.
 *
 * Access via `sna.sessions`.
 *
 * The SNA server automatically pushes a full `sessions.snapshot` on
 * every WebSocket connection and whenever session state changes.
 * Use {@link onSnapshot} to receive these — no polling needed.
 *
 * @example
 * ```ts
 * // Listen for session snapshots (reactive, no polling)
 * sna.sessions.onSnapshot((sessions) => {
 *   const active = sessions.filter(s => s.alive);
 *   console.log(`${active.length} active sessions`);
 * });
 *
 * // Create a new session
 * const { sessionId } = await sna.sessions.create({ label: "my-task" });
 * ```
 */
declare class SessionsApi {
    private client;
    private snapshotUnsub;
    constructor(client: SnaClient);
    /**
     * Create a new agent session on the server.
     *
     * The session is created in a stopped state — call
     * {@link AgentApi.start | sna.agent.start()} to spawn an agent in it.
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
 * @example Full lifecycle
 * ```ts
 * // Start an agent
 * await sna.agent.start("default", {
 *   prompt: "Analyze this codebase",
 *   model: "claude-sonnet-4-6",
 * });
 *
 * // Stream events in real-time
 * sna.agent.onEvent(({ session, event }) => {
 *   switch (event.type) {
 *     case "thinking":   console.log("[thinking]", event.message); break;
 *     case "assistant":  console.log("[reply]", event.message);    break;
 *     case "tool_use":   console.log("[tool]", event.data);        break;
 *     case "complete":   console.log("Done!");                     break;
 *   }
 * });
 * await sna.agent.subscribe("default", { since: 0 });
 *
 * // Send follow-up messages
 * await sna.agent.send("default", "Now fix the bug you found");
 *
 * // Handle permission requests
 * sna.agent.onPermissionRequest(({ session, request }) => {
 *   console.log("Agent wants to:", request);
 *   sna.agent.respondPermission(session, true);
 * });
 * await sna.agent.subscribePermissions();
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

export { type AgentStartConfig, type ConnectionStatus, type SessionInfo, SnaClient, type SnaClientOptions, type WsMessage };
