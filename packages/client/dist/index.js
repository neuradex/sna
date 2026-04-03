// src/sna-client.ts
var SnaClient = class {
  constructor(options) {
    this.ws = null;
    this._status = "disconnected";
    this.ridCounter = 0;
    this.pending = /* @__PURE__ */ new Map();
    this.pushHandlers = /* @__PURE__ */ new Map();
    this.statusListeners = /* @__PURE__ */ new Set();
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.disposed = false;
    this.url = options.url;
    this._reconnect = options.reconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 2e3;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 0;
    this.sessions = new SessionsApi(this);
    this.agent = new AgentApi(this);
  }
  // ── Connection lifecycle ──────────────────────────────────────
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
  get status() {
    return this._status;
  }
  /**
   * Shorthand for `status === "connected"`.
   *
   * @example
   * ```ts
   * await waitFor(() => sna.connected);
   * ```
   */
  get connected() {
    return this._status === "connected";
  }
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
  connect() {
    if (this.ws && this._status !== "disconnected") return;
    this.disposed = false;
    this.doConnect();
  }
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
  disconnect() {
    this.disposed = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1e3, "client disconnect");
      this.ws = null;
    }
    this.rejectAllPending("disconnected");
    this.setStatus("disconnected");
  }
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
  onConnectionStatus(cb) {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }
  // ── Request / Push ────────────────────────────────────────────
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
  request(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this._status !== "connected") {
        reject(new Error("Not connected"));
        return;
      }
      const rid = String(++this.ridCounter);
      this.pending.set(rid, { resolve, reject });
      this.ws.send(JSON.stringify({ ...payload, type, rid }));
    });
  }
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
  onPush(type, handler) {
    let set = this.pushHandlers.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.pushHandlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }
  // ── Internal ──────────────────────────────────────────────────
  doConnect() {
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.resubscribe();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      if (msg.rid && this.pending.has(msg.rid)) {
        const p = this.pending.get(msg.rid);
        this.pending.delete(msg.rid);
        if (msg.type === "error") {
          p.reject(new Error(msg.message ?? "Unknown error"));
        } else {
          p.resolve(msg);
        }
        return;
      }
      const handlers = this.pushHandlers.get(msg.type);
      if (handlers) {
        for (const h of handlers) h(msg);
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.rejectAllPending("connection closed");
      this.setStatus("disconnected");
      if (!this.disposed && this._reconnect) {
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => {
    };
    this.ws = ws;
  }
  setStatus(status) {
    if (this._status === status) return;
    this._status = status;
    for (const cb of this.statusListeners) cb(status);
  }
  rejectAllPending(reason) {
    for (const [, p] of this.pending) {
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }
  scheduleReconnect() {
    if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.doConnect();
    }, this.reconnectDelay);
  }
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  /** Called after reconnect — re-registers server-side subscriptions. */
  resubscribe() {
    this.agent._resubscribe();
  }
};
var SessionsApi = class {
  constructor(client) {
    this.client = client;
    this.snapshotUnsub = null;
  }
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
  async create(opts = {}) {
    return this.client.request("sessions.create", opts);
  }
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
  async remove(session) {
    return this.client.request("sessions.remove", { session });
  }
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
  async update(session, opts) {
    return this.client.request("sessions.update", { session, ...opts });
  }
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
  onSnapshot(cb) {
    this.snapshotUnsub?.();
    this.snapshotUnsub = this.client.onPush("sessions.snapshot", (msg) => {
      cb(msg.sessions);
    });
    return () => {
      this.snapshotUnsub?.();
      this.snapshotUnsub = null;
    };
  }
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
  onConfigChanged(cb) {
    return this.client.onPush("session.config-changed", (msg) => {
      cb(msg);
    });
  }
};
var AgentApi = class {
  constructor(client) {
    this.client = client;
    this.subscribedSessions = /* @__PURE__ */ new Set();
    this.permissionSubscribed = false;
  }
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
  async start(session, config = {}) {
    return this.client.request("agent.start", { session, ...config });
  }
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
  async send(session, message, opts) {
    return this.client.request("agent.send", { session, message, ...opts });
  }
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
  async kill(session) {
    return this.client.request("agent.kill", { session });
  }
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
  async restart(session, config) {
    return this.client.request("agent.restart", { session, ...config });
  }
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
  async interrupt(session) {
    return this.client.request("agent.interrupt", { session });
  }
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
  async resume(session, opts) {
    return this.client.request("agent.resume", { session, ...opts });
  }
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
  async getStatus(session) {
    return this.client.request("agent.status", { session });
  }
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
  async setModel(session, model) {
    return this.client.request("agent.set-model", { session, model });
  }
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
  async setPermissionMode(session, permissionMode) {
    return this.client.request("agent.set-permission-mode", { session, permissionMode });
  }
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
  async subscribe(session, opts) {
    this.subscribedSessions.add(session);
    return this.client.request("agent.subscribe", { session, ...opts });
  }
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
  async unsubscribe(session) {
    this.subscribedSessions.delete(session);
    await this.client.request("agent.unsubscribe", { session });
  }
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
  onEvent(cb) {
    return this.client.onPush("agent.event", (msg) => {
      cb({
        session: msg.session,
        cursor: msg.cursor,
        event: msg.event,
        isHistory: msg.isHistory
      });
    });
  }
  // ── Permission (agent-scoped) ─────────────────────────────────
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
  async subscribePermissions() {
    this.permissionSubscribed = true;
    return this.client.request("permission.subscribe");
  }
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
  async unsubscribePermissions() {
    this.permissionSubscribed = false;
    await this.client.request("permission.unsubscribe");
  }
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
  async respondPermission(session, approved) {
    return this.client.request("permission.respond", { session, approved });
  }
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
  async getPendingPermissions(session) {
    return this.client.request("permission.pending", session ? { session } : {});
  }
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
  onPermissionRequest(cb) {
    return this.client.onPush("permission.request", (msg) => {
      cb({
        session: msg.session,
        request: msg.request,
        createdAt: msg.createdAt,
        isHistory: msg.isHistory
      });
    });
  }
  /** @internal Re-subscribe after reconnect — called automatically by SnaClient. */
  _resubscribe() {
    for (const session of this.subscribedSessions) {
      this.client.request("agent.subscribe", { session }).catch(() => {
      });
    }
    if (this.permissionSubscribed) {
      this.client.request("permission.subscribe").catch(() => {
      });
    }
  }
};
export {
  SnaClient
};
