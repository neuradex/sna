/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

import type { AgentProcess, AgentEvent } from "../core/providers/types.js";
import { getDb } from "../db/schema.js";
import { insertChatMessage, updateChatMessageMeta } from "../db/chat-messages.js";
import { getConfig } from "../config.js";

export type SessionState = "idle" | "processing" | "waiting" | "permission";

export interface StartConfig {
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

export interface Session {
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

export type AgentStatus = "idle" | "busy" | "disconnected";

export interface SessionInfo {
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
  lastMessage: { actor: string; kind: string; content: string; created_at: string } | null;
  createdAt: number;
  lastActivityAt: number;
}

export interface SessionManagerOptions {
  maxSessions?: number;
}

interface PendingPermission {
  resolve: (approved: boolean) => void;
  request: Record<string, unknown>;
  createdAt: number;
}

export type SessionLifecycleState = "started" | "resumed" | "killed" | "exited" | "crashed" | "restarted";

export interface SessionLifecycleEvent {
  session: string;
  state: SessionLifecycleState;
  code?: number | null;
}

export interface SessionConfigChangedEvent {
  session: string;
  config: StartConfig;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private maxSessions: number;
  private eventListeners = new Map<string, Set<(cursor: number, event: AgentEvent) => void>>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private skillEventListeners = new Set<(event: Record<string, unknown>) => void>();
  private permissionRequestListeners = new Set<(sessionId: string, request: Record<string, unknown>, createdAt: number) => void>();
  private lifecycleListeners = new Set<(event: SessionLifecycleEvent) => void>();
  private configChangedListeners = new Set<(event: SessionConfigChangedEvent) => void>();
  private stateChangedListeners = new Set<(event: { session: string; agentStatus: AgentStatus; state: SessionState }) => void>();
  private metadataChangedListeners = new Set<(sessionId: string) => void>();

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? getConfig().maxSessions;
    this.restoreFromDb();
  }

  /** Restore session metadata from DB (cwd, label, meta). Process state is not restored. */
  private restoreFromDb(): void {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, meta, cwd, last_start_config, created_at FROM chat_sessions`
      ).all() as { id: string; label: string; meta: string | null; cwd: string | null; last_start_config: string | null; created_at: string }[];
      for (const row of rows) {
        if (this.sessions.has(row.id)) continue;
        this.sessions.set(row.id, {
          id: row.id,
          process: null,
          eventBuffer: [],
          eventCounter: 0,
          label: row.label,
          cwd: row.cwd ?? process.cwd(),
          meta: row.meta ? JSON.parse(row.meta) : null,
          state: "idle",
          lastStartConfig: row.last_start_config ? JSON.parse(row.last_start_config) : null,
          ccSessionId: null,
          createdAt: new Date(row.created_at).getTime() || Date.now(),
          lastActivityAt: Date.now(),
        });
      }
    } catch { /* DB not ready — skip restore */ }
  }

  /** Persist session metadata to DB. */
  private persistSession(session: Session): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO chat_sessions (id, label, type, meta, cwd, last_start_config)
         VALUES (?, ?, 'main', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           meta = excluded.meta,
           cwd = excluded.cwd,
           last_start_config = excluded.last_start_config`
      ).run(
        session.id,
        session.label,
        session.meta ? JSON.stringify(session.meta) : null,
        session.cwd,
        session.lastStartConfig ? JSON.stringify(session.lastStartConfig) : null,
      );
    } catch { /* non-fatal */ }
  }

  /** Create a new session. Throws if session already exists or max sessions reached. */
  createSession(opts: {
    id?: string;
    label?: string;
    cwd?: string;
    meta?: Record<string, unknown> | null;
  } = {}): Session {
    const id = opts.id ?? crypto.randomUUID().slice(0, 8);

    if (this.sessions.has(id)) {
      throw new Error(`Session "${id}" already exists`);
    }

    const aliveCount = Array.from(this.sessions.values())
      .filter((s) => s.process?.alive).length;
    if (aliveCount >= this.maxSessions) {
      throw new Error(`Max active sessions (${this.maxSessions}) reached — ${aliveCount} alive`);
    }

    const session: Session = {
      id,
      process: null,
      eventBuffer: [],
      eventCounter: 0,
      label: opts.label ?? id,
      cwd: opts.cwd ?? process.cwd(),
      meta: opts.meta ?? null,
      state: "idle",
      lastStartConfig: null,
      ccSessionId: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.sessions.set(id, session);
    this.persistSession(session);
    return session;
  }

  /** Update an existing session's metadata. Throws if session not found. */
  updateSession(id: string, opts: {
    label?: string;
    meta?: Record<string, unknown> | null;
    cwd?: string;
  }): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session "${id}" not found`);

    if (opts.label !== undefined) session.label = opts.label;
    if (opts.meta !== undefined) session.meta = opts.meta;
    if (opts.cwd !== undefined) session.cwd = opts.cwd;
    this.persistSession(session);
    this.emitMetadataChanged(id);
    return session;
  }

  /** Get a session by ID. */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Get or create a session (used for "default" backward compat). */
  getOrCreateSession(id: string, opts?: { label?: string; cwd?: string }): Session {
    const existing = this.sessions.get(id);
    if (existing) {
      // Update cwd if provided (handles server restart where session was recreated with wrong cwd)
      if (opts?.cwd && opts.cwd !== existing.cwd) {
        existing.cwd = opts.cwd;
        this.persistSession(existing);
      }
      return existing;
    }
    return this.createSession({ id, ...opts });
  }

  /** Set the agent process for a session. Subscribes to events. */
  setProcess(sessionId: string, proc: AgentProcess, lifecycleState?: SessionLifecycleState): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    session.process = proc;
    session.lastActivityAt = Date.now();

    // Sync eventCounter with DB history so live event cursors continue
    // from where history left off. This ensures monotonically increasing
    // cursors across restart/resume — clients using since=cursor won't
    // see duplicates or gaps.
    session.eventBuffer.length = 0;
    try {
      const db = getDb();
      const row = db.prepare(
        `SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?`
      ).get(sessionId) as { c: number };
      session.eventCounter = row.c;
    } catch {
      // DB not ready — keep existing counter
    }

    proc.on("event", (e: AgentEvent) => {
      // Capture Claude Code's session ID from init event
      if (e.type === "init") {
        if (e.data?.sessionId && !session.ccSessionId) {
          session.ccSessionId = e.data.sessionId as string;
          this.persistSession(session);
        }
        // Agent is ready for input — transition from "processing" to "waiting".
        // If a prompt was sent, the agent immediately starts processing and
        // a subsequent complete/error event will fire. If no prompt (e.g. resume
        // without prompt), the agent stays in "waiting" as expected.
        this.setSessionState(sessionId, session, "waiting");
      }
      // Update session state based on event type
      if (e.type === "thinking" || e.type === "tool_use" || e.type === "assistant_delta") {
        this.setSessionState(sessionId, session, "processing");
      } else if (e.type === "complete" || e.type === "error" || e.type === "interrupted") {
        this.setSessionState(sessionId, session, "waiting");
      }

      // Auto-create pending permission for providers with bidirectional approval
      // (e.g. Codex JSON-RPC). Claude Code handles this via external hook script.
      if (e.type === "permission_needed" && e.data?.requestId && proc.respondToPermission) {
        const requestId = e.data.requestId as string;
        this.createPendingPermission(sessionId, {
          tool_name: e.data.toolName as string,
          command: e.data.command,
          path: e.data.path,
          requestId,
        }).then((approved) => {
          proc.respondToPermission!(requestId, approved);
        });
      }

      // Persist to DB first — only persisted events increment the cursor.
      // This keeps eventCounter === DB row count, so history replay and
      // live cursors share the same monotonic sequence with no gaps or overlaps.
      const persisted = this.persistEvent(sessionId, e);

      if (persisted) {
        session.eventCounter++;
        session.eventBuffer.push(e);
        if (session.eventBuffer.length > getConfig().maxEventBuffer) {
          session.eventBuffer.splice(0, session.eventBuffer.length - getConfig().maxEventBuffer);
        }
      }

      // Always broadcast to listeners — each listener decides what to handle.
      // cursor > 0 = persisted event with sequence position.
      // cursor = -1 = transient (not in buffer, no sequence position).
      const cursor = persisted ? session.eventCounter : -1;
      const listeners = this.eventListeners.get(sessionId);
      if (listeners) {
        for (const cb of listeners) cb(cursor, e);
      }
    });

    proc.on("exit", (code) => {
      this.setSessionState(sessionId, session, "idle");
      this.emitLifecycle({ session: sessionId, state: code != null ? "exited" : "crashed", code });
    });

    proc.on("error", () => {
      this.setSessionState(sessionId, session, "idle");
      this.emitLifecycle({ session: sessionId, state: "crashed" });
    });

    this.emitLifecycle({ session: sessionId, state: lifecycleState ?? "started" });
  }

  // ── Event pub/sub (for WebSocket) ─────────────────────────────

  /** Subscribe to real-time events for a session. Returns unsubscribe function. */
  onSessionEvent(sessionId: string, cb: (cursor: number, event: AgentEvent) => void): () => void {
    let set = this.eventListeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.eventListeners.set(sessionId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.eventListeners.delete(sessionId);
    };
  }

  // ── Skill event pub/sub ────────────────────────────────────────

  /** Subscribe to skill events broadcast. Returns unsubscribe function. */
  onSkillEvent(cb: (event: Record<string, unknown>) => void): () => void {
    this.skillEventListeners.add(cb);
    return () => this.skillEventListeners.delete(cb);
  }

  /** Broadcast a skill event to all subscribers (called after DB insert). */
  broadcastSkillEvent(event: Record<string, unknown>): void {
    for (const cb of this.skillEventListeners) cb(event);
  }

  /** Push a synthetic event into a session's event stream (for user message broadcast). */
  /**
   * Push an externally-persisted event into the session.
   * The caller is responsible for DB persistence — this method only updates
   * the in-memory counter/buffer and notifies listeners.
   * eventCounter increments to stay in sync with the DB row count.
   */
  pushEvent(sessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.eventCounter++;
    session.eventBuffer.push(event);
    if (session.eventBuffer.length > getConfig().maxEventBuffer) {
      session.eventBuffer.splice(0, session.eventBuffer.length - getConfig().maxEventBuffer);
    }
    const listeners = this.eventListeners.get(sessionId);
    if (listeners) {
      for (const cb of listeners) cb(session.eventCounter, event);
    }
  }

  // ── Permission pub/sub ────────────────────────────────────────

  /** Subscribe to permission request notifications. Returns unsubscribe function. */
  onPermissionRequest(cb: (sessionId: string, request: Record<string, unknown>, createdAt: number) => void): () => void {
    this.permissionRequestListeners.add(cb);
    return () => this.permissionRequestListeners.delete(cb);
  }

  // ── Session lifecycle pub/sub ──────────────────────────────────

  /** Subscribe to session lifecycle events (started/killed/exited/crashed). Returns unsubscribe function. */
  onSessionLifecycle(cb: (event: SessionLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(cb);
    return () => this.lifecycleListeners.delete(cb);
  }

  private emitLifecycle(event: SessionLifecycleEvent): void {
    for (const cb of this.lifecycleListeners) cb(event);
  }

  // ── Config changed pub/sub ────────────────────────────────────

  /** Subscribe to session config changes. Returns unsubscribe function. */
  onConfigChanged(cb: (event: SessionConfigChangedEvent) => void): () => void {
    this.configChangedListeners.add(cb);
    return () => this.configChangedListeners.delete(cb);
  }

  private emitConfigChanged(sessionId: string, config: StartConfig): void {
    for (const cb of this.configChangedListeners) cb({ session: sessionId, config });
  }

  // ── Session metadata change pub/sub ─────────────────────────────

  onMetadataChanged(cb: (sessionId: string) => void): () => void {
    this.metadataChangedListeners.add(cb);
    return () => this.metadataChangedListeners.delete(cb);
  }

  private emitMetadataChanged(sessionId: string): void {
    for (const cb of this.metadataChangedListeners) cb(sessionId);
  }

  // ── Agent status change pub/sub ────────────────────────────────

  onStateChanged(cb: (event: { session: string; agentStatus: AgentStatus; state: SessionState }) => void): () => void {
    this.stateChangedListeners.add(cb);
    return () => this.stateChangedListeners.delete(cb);
  }

  /** Update session state and push agentStatus change to subscribers. */
  updateSessionState(sessionId: string, newState: SessionState): void {
    const session = this.sessions.get(sessionId);
    if (session) this.setSessionState(sessionId, session, newState);
  }

  private setSessionState(sessionId: string, session: Session, newState: SessionState): void {
    const oldState = session.state;
    session.state = newState;
    const newStatus: AgentStatus = !session.process?.alive ? "disconnected" : (newState === "processing" ? "busy" : "idle");
    if (oldState !== newState) {
      for (const cb of this.stateChangedListeners) cb({ session: sessionId, agentStatus: newStatus, state: newState });
    }
  }

  // ── Permission management ─────────────────────────────────────

  /** Create a pending permission request. Returns a promise that resolves when approved/denied. */
  createPendingPermission(sessionId: string, request: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) this.setSessionState(sessionId, session, "permission");

    return new Promise<boolean>((resolve) => {
      const createdAt = Date.now();
      this.pendingPermissions.set(sessionId, { resolve, request, createdAt });
      // Notify permission subscribers (WS push)
      for (const cb of this.permissionRequestListeners) cb(sessionId, request, createdAt);
      // Auto-deny after timeout (0 = no timeout, app controls)
      const timeout = opts?.timeoutMs ?? getConfig().permissionTimeoutMs;
      if (timeout > 0) {
        setTimeout(() => {
          if (this.pendingPermissions.has(sessionId)) {
            this.pendingPermissions.delete(sessionId);
            resolve(false);
          }
        }, timeout);
      }
    });
  }

  /** Resolve a pending permission request. Returns false if no pending request. */
  resolvePendingPermission(sessionId: string, approved: boolean): boolean {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) return false;
    pending.resolve(approved);
    this.pendingPermissions.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) this.setSessionState(sessionId, session, "processing");
    return true;
  }

  /** Get a pending permission for a specific session. */
  getPendingPermission(sessionId: string): { request: Record<string, unknown>; createdAt: number } | null {
    const p = this.pendingPermissions.get(sessionId);
    return p ? { request: p.request, createdAt: p.createdAt } : null;
  }

  /** Get all pending permissions across sessions. */
  getAllPendingPermissions(): Array<{ sessionId: string; request: Record<string, unknown>; createdAt: number }> {
    return Array.from(this.pendingPermissions.entries()).map(([id, p]) => ({
      sessionId: id,
      request: p.request,
      createdAt: p.createdAt,
    }));
  }

  // ── Session lifecycle ─────────────────────────────────────────

  /** Kill the agent process in a session (session stays, can be restarted). */
  /** Save the start config for a session (called by start handlers). */
  saveStartConfig(id: string, config: StartConfig): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastStartConfig = config;
    this.persistSession(session);
  }

  /** Restart session: kill → re-spawn with merged config + --resume. */
  restartSession(
    id: string,
    overrides: Partial<StartConfig>,
    spawnFn: (config: StartConfig) => AgentProcess,
  ): { config: StartConfig } {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session "${id}" not found`);

    const base = session.lastStartConfig;
    if (!base) throw new Error(`Session "${id}" has no previous start config`);

    // Merge strategy: overrides win. Provider-specific fields (extraArgs,
    // providerOptions, configDir) are dropped when switching providers, since
    // CLI flags and structured options are not transferable across runtimes.
    // Inheriting them silently — as the prior implementation did — caused
    // Codex to receive Claude-specific --settings flags and crash with exit 2.
    const nextProvider = overrides.provider ?? base.provider;
    const providerChanged = nextProvider !== base.provider;

    const config: StartConfig = {
      provider: nextProvider,
      // modelProvider is attribution metadata, not runtime-specific. Caller
      // (e.g. Loom) decides it via its model catalog and passes it in with
      // the override. Drop the base value when the override is absent on a
      // provider change, since the inherited modelProvider no longer matches.
      modelProvider: overrides.modelProvider ?? (providerChanged ? undefined : base.modelProvider),
      model: overrides.model ?? base.model,
      permissionMode: overrides.permissionMode ?? base.permissionMode,
      configDir: providerChanged ? overrides.configDir : (overrides.configDir ?? base.configDir),
      extraArgs: providerChanged ? overrides.extraArgs : (overrides.extraArgs ?? base.extraArgs),
      providerOptions: providerChanged ? overrides.providerOptions : (overrides.providerOptions ?? base.providerOptions),
    };

    // Kill existing
    if (session.process?.alive) session.process.kill();

    // Spawn with merged config + --resume
    const proc = spawnFn(config);
    this.setProcess(id, proc);
    session.lastStartConfig = config;
    this.persistSession(session);
    this.emitLifecycle({ session: id, state: "restarted" });
    this.emitConfigChanged(id, config);

    return { config };
  }

  /** Interrupt the current turn. Process stays alive, returns to waiting. */
  interruptSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.interrupt();
    this.setSessionState(id, session, "waiting");
    return true;
  }

  /** Change model. Sends control message if alive, always persists to config. */
  setSessionModel(id: string, model: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.setModel(model);
    if (session.lastStartConfig) {
      session.lastStartConfig.model = model;
    } else {
      session.lastStartConfig = { provider: getConfig().defaultProvider, model, permissionMode: getConfig().defaultPermissionMode };
    }
    this.persistSession(session);
    this.emitConfigChanged(id, session.lastStartConfig);
    return true;
  }

  /** Change permission mode. Sends control message if alive, always persists to config. */
  setSessionPermissionMode(id: string, mode: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.setPermissionMode(mode);
    if (session.lastStartConfig) {
      session.lastStartConfig.permissionMode = mode;
    } else {
      session.lastStartConfig = { provider: getConfig().defaultProvider, model: getConfig().model, permissionMode: mode };
    }
    this.persistSession(session);
    this.emitConfigChanged(id, session.lastStartConfig);
    return true;
  }

  /** Kill the agent process in a session (session stays, can be restarted). */
  killSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.kill();
    this.emitLifecycle({ session: id, state: "killed" });
    return true;
  }

  /** Remove a session entirely. Cannot remove "default". */
  removeSession(id: string): boolean {
    if (id === "default") return false;
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.kill();
    // Cleanup listeners
    this.eventListeners.delete(id);
    this.pendingPermissions.delete(id);
    this.sessions.delete(id);
    return true;
  }

  /** List all sessions as serializable info objects. */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      label: s.label,
      alive: s.process?.alive ?? false,
      state: s.state,
      agentStatus: !s.process?.alive ? "disconnected" : (s.state === "processing" ? "busy" : "idle") as AgentStatus,
      cwd: s.cwd,
      meta: s.meta,
      config: s.lastStartConfig,
      ccSessionId: s.ccSessionId,
      eventCount: s.eventCounter,
      ...this.getMessageStats(s.id),
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
    }));
  }

  /** Touch a session's lastActivityAt timestamp. */
  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.lastActivityAt = Date.now();
  }

  /** Persist an agent event to chat_messages. */
  private getMessageStats(sessionId: string): { messageCount: number; lastMessage: { actor: string; kind: string; content: string; created_at: string } | null } {
    try {
      const db = getDb();
      const count = db.prepare(
        `SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?`
      ).get(sessionId) as { c: number };
      const last = db.prepare(
        `SELECT actor, kind, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1`
      ).get(sessionId) as { actor: string; kind: string; content: string; created_at: string } | undefined;
      return {
        messageCount: count.c,
        lastMessage: last ? { actor: last.actor, kind: last.kind, content: last.content, created_at: last.created_at } : null,
      };
    } catch {
      return { messageCount: 0, lastMessage: null };
    }
  }

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
  private persistEvent(sessionId: string, e: AgentEvent): boolean {
    try {
      const db = getDb();
      const session = this.sessions.get(sessionId);
      const attr: Record<string, unknown> = {};
      // The SDK's internal field name for the CLI is `provider` (runtime
      // dispatch key), but we surface it as `runtime` in the canonical meta
      // to disambiguate from the LLM API vendor (`modelProvider`).
      if (session?.lastStartConfig?.provider) attr.runtime = session.lastStartConfig.provider;
      if (session?.lastStartConfig?.modelProvider) attr.modelProvider = session.lastStartConfig.modelProvider;
      if (session?.lastStartConfig?.model) attr.model = session.lastStartConfig.model;

      switch (e.type) {
        case "assistant":
          if (!e.message) return false;
          insertChatMessage(db, {
            sessionId, actor: "assistant", kind: "text", content: e.message,
            meta: Object.keys(attr).length > 0 ? attr : undefined,
          });
          return true;

        case "thinking":
          if (!e.message) return false;
          insertChatMessage(db, {
            sessionId, actor: "assistant", kind: "thinking", content: e.message,
            meta: {
              ...attr,
              ...(e.data?.signature ? { signature: e.data.signature } : {}),
            },
          });
          return true;

        case "tool_use": {
          const toolName = (e.data?.toolName as string) ?? e.message ?? "tool";
          const toolUseId = (e.data?.id ?? e.data?.toolUseId) as string | undefined;
          // Streaming "update" event — refresh the still-open tool_use row's
          // meta with the fully assembled input, don't create a new row.
          // Note: the existing row already has {provider, model} from the
          // initial insert, so the merge preserves attribution.
          if (e.data?.update && toolUseId) {
            const row = db.prepare(
              `SELECT id, meta FROM chat_messages
                WHERE session_id = ? AND actor = 'assistant' AND kind = 'tool_use'
                  AND json_extract(meta, '$.id') = ?
                ORDER BY id DESC LIMIT 1`,
            ).get(sessionId, toolUseId) as { id: number; meta: string | null } | undefined;
            if (row) {
              const mergedMeta = {
                ...(row.meta ? JSON.parse(row.meta) : {}),
                ...(e.data as Record<string, unknown>),
                id: toolUseId,
              };
              updateChatMessageMeta(db, row.id, mergedMeta);
            }
            return false;
          }
          insertChatMessage(db, {
            sessionId, actor: "assistant", kind: "tool_use", content: toolName,
            meta: { ...attr, ...(e.data ?? {}), id: toolUseId, name: toolName },
          });
          return true;
        }

        case "tool_result": {
          const toolUseId = (e.data?.toolUseId ?? e.data?.id) as string | undefined;
          insertChatMessage(db, {
            sessionId, actor: "system", kind: "tool_result", content: e.message ?? "",
            meta: { ...(e.data ?? {}), toolUseId },
          });
          return true;
        }

        case "complete":
          insertChatMessage(db, {
            sessionId, actor: "system", kind: "status", content: "",
            meta: { status: "complete", ...(e.data ?? {}) },
          });
          return true;

        case "error":
          insertChatMessage(db, {
            sessionId, actor: "system", kind: "error", content: e.message ?? "Error",
            meta: { status: "error" },
          });
          return true;

        default:
          return false;
      }
    } catch { return false; }
  }

  /** Kill all sessions. Used during shutdown. */
  killAll(): void {
    const pids: number[] = [];
    for (const session of this.sessions.values()) {
      if (session.process?.alive) {
        const pid = session.process.pid;
        session.process.kill();
        if (pid) pids.push(pid);
      }
    }
    // Force-kill any survivors after a brief grace period
    if (pids.length > 0) {
      setTimeout(() => {
        for (const pid of pids) {
          try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
        }
      }, 1000);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
