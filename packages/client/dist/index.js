// src/sna-client.ts
function resolveTransports(options) {
  let base = options.baseUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) {
    base = "http://" + base;
  }
  const wsUrl = options.ws ? base.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://") + "/ws" : null;
  const httpBase = options.http ? base : null;
  if (!wsUrl && !httpBase) {
    console.warn("[SnaClient] Both ws and http are false \u2014 no transport is available.");
  }
  return { wsUrl, httpBase };
}
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
    const { wsUrl, httpBase } = resolveTransports(options);
    this.wsUrl = wsUrl;
    this._httpUrl = httpBase ?? void 0;
    this._reconnect = options.reconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 2e3;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 0;
    this.sessions = new SessionsApi(this);
    this.agent = new AgentApi(this);
    this.events = new EventsApi(this);
    this.chat = new ChatApi(this);
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
    if (!this.wsUrl) {
      console.warn("[SnaClient] connect() called but ws is disabled (ws: false).");
      return;
    }
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
  // ── HTTP transport (internal) ─────────────────────────────────
  /**
   * Perform a REST request against the SNA HTTP server.
   *
   * Used internally by {@link SessionsApi} and {@link AgentApi} when
   * {@link SnaClientOptions.httpUrl} is configured. Falls back to WS
   * if `httpUrl` is not set.
   *
   * @internal
   */
  async _httpFetch(method, path, body) {
    const base = this._httpUrl.replace(/\/$/, "");
    const hasBody = body !== void 0 && method !== "GET" && method !== "DELETE";
    const res = await fetch(base + path, {
      method,
      headers: hasBody ? { "Content-Type": "application/json" } : void 0,
      body: hasBody ? JSON.stringify(body) : void 0
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
    return data;
  }
  /**
   * Parse an SSE response as an AsyncGenerator.
   * Yields parsed JSON objects from `data:` lines.
   * @internal
   */
  static async *_parseSse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data) {
              try {
                yield JSON.parse(data);
              } catch {
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  // ── Internal ──────────────────────────────────────────────────
  doConnect() {
    this.setStatus("connecting");
    const ws = new WebSocket(this.wsUrl);
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
  async list() {
    if (this.client._httpUrl) {
      return this.client._httpFetch("GET", "/agent/sessions");
    }
    return this.client.request("sessions.list");
  }
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
  async create(opts = {}) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", "/agent/sessions", opts);
    }
    return this.client.request("sessions.create", opts);
  }
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
  async remove(session) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("DELETE", `/agent/sessions/${encodeURIComponent(session)}`);
    }
    return this.client.request("sessions.remove", { session });
  }
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
  async update(session, opts) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("PATCH", `/agent/sessions/${encodeURIComponent(session)}`, opts);
    }
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
  async start(session, config = {}) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/start?session=${encodeURIComponent(session)}`, config);
    }
    return this.client.request("agent.start", { session, ...config });
  }
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
  async send(session, message, opts) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/send?session=${encodeURIComponent(session)}`, { message, ...opts });
    }
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
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/kill?session=${encodeURIComponent(session)}`);
    }
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
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/restart?session=${encodeURIComponent(session)}`, config ?? {});
    }
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
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/interrupt?session=${encodeURIComponent(session)}`);
    }
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
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/resume?session=${encodeURIComponent(session)}`, opts ?? {});
    }
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
    if (this.client._httpUrl) {
      return this.client._httpFetch("GET", `/agent/status?session=${encodeURIComponent(session)}`);
    }
    return this.client.request("agent.status", { session });
  }
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
  async runOnce(opts) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", "/agent/run-once", opts);
    }
    return this.client.request("agent.run-once", opts);
  }
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
  async *streamEvents(session, since) {
    if (!this.client._httpUrl) throw new Error("streamEvents requires http: true");
    const base = this.client._httpUrl.replace(/\/$/, "");
    const params = new URLSearchParams({ session });
    if (since !== void 0) params.set("since", String(since));
    const res = await fetch(`${base}/agent/events?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    yield* SnaClient._parseSse(res);
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
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/set-model?session=${encodeURIComponent(session)}`, { model });
    }
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
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/agent/set-permission-mode?session=${encodeURIComponent(session)}`, { permissionMode });
    }
    return this.client.request("agent.set-permission-mode", { session, permissionMode });
  }
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
var EventsApi = class {
  constructor(client) {
    this.client = client;
  }
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
  async subscribe(opts) {
    return this.client.request("events.subscribe", opts ?? {});
  }
  /**
   * Unsubscribe from skill event pushes.
   *
   * @example
   * ```ts
   * await sna.events.unsubscribe();
   * ```
   */
  async unsubscribe() {
    await this.client.request("events.unsubscribe", {});
  }
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
  async emit(opts) {
    if (this.client._httpUrl) {
      const { eventType, ...rest } = opts;
      return this.client._httpFetch("POST", "/emit", { ...rest, type: eventType });
    }
    return this.client.request("emit", opts);
  }
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
  onSkillEvent(cb) {
    return this.client.onPush("skill.event", (msg) => {
      cb(msg.data);
    });
  }
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
  async *stream(since) {
    if (!this.client._httpUrl) throw new Error("events.stream() requires http: true");
    const base = this.client._httpUrl.replace(/\/$/, "");
    const params = since !== void 0 ? `?since=${since}` : "";
    const res = await fetch(`${base}/events${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for await (const data of SnaClient._parseSse(res)) {
      yield data;
    }
  }
};
var ChatApi = class {
  constructor(client) {
    this.client = client;
  }
  // ── Chat sessions ─────────────────────────────────────────────
  /**
   * List all chat sessions.
   *
   * @example
   * ```ts
   * const { sessions } = await sna.chat.listSessions();
   * ```
   */
  async listSessions() {
    if (this.client._httpUrl) {
      return this.client._httpFetch("GET", "/chat/sessions");
    }
    return this.client.request("chat.sessions.list");
  }
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
  async createSession(opts) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", "/chat/sessions", opts ?? {});
    }
    const { type: chatType, ...rest } = opts ?? {};
    return this.client.request("chat.sessions.create", { ...rest, ...chatType ? { chatType } : {} });
  }
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
  async removeSession(session) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("DELETE", `/chat/sessions/${encodeURIComponent(session)}`);
    }
    return this.client.request("chat.sessions.remove", { session });
  }
  // ── Chat messages ─────────────────────────────────────────────
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
  async listMessages(session, opts) {
    if (this.client._httpUrl) {
      const base = `/chat/sessions/${encodeURIComponent(session)}/messages`;
      const path = opts?.since !== void 0 ? `${base}?since=${opts.since}` : base;
      return this.client._httpFetch("GET", path);
    }
    return this.client.request("chat.messages.list", { session, ...opts });
  }
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
  async createMessage(session, opts) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("POST", `/chat/sessions/${encodeURIComponent(session)}/messages`, opts);
    }
    return this.client.request("chat.messages.create", { session, ...opts });
  }
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
  async clearMessages(session) {
    if (this.client._httpUrl) {
      return this.client._httpFetch("DELETE", `/chat/sessions/${encodeURIComponent(session)}/messages`);
    }
    return this.client.request("chat.messages.clear", { session });
  }
};
export {
  SnaClient
};
