/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

import type { AgentProcess, AgentEvent } from "../core/providers/types.js";
import { getDb } from "../db/schema.js";

export type SessionState = "idle" | "processing" | "waiting" | "permission";

export interface StartConfig {
  provider: string;
  model: string;
  permissionMode: string;
  extraArgs?: string[];
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
  lastMessage: { role: string; content: string; created_at: string } | null;
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

const DEFAULT_MAX_SESSIONS = 5;
const MAX_EVENT_BUFFER = 500;
const PERMISSION_TIMEOUT_MS = 300_000; // 5 minutes

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

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
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

  /** Create a new session. Throws if max sessions reached. */
  createSession(opts: {
    id?: string;
    label?: string;
    cwd?: string;
    meta?: Record<string, unknown> | null;
  } = {}): Session {
    const id = opts.id ?? crypto.randomUUID().slice(0, 8);

    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      let changed = false;
      if (opts.cwd && opts.cwd !== existing.cwd) { existing.cwd = opts.cwd; changed = true; }
      if (opts.label && opts.label !== existing.label) { existing.label = opts.label; changed = true; }
      if (opts.meta !== undefined && opts.meta !== existing.meta) { existing.meta = opts.meta ?? null; changed = true; }
      if (changed) this.persistSession(existing);
      return existing;
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
    this.setSessionState(sessionId, session, "processing");
    session.lastActivityAt = Date.now();

    proc.on("event", (e: AgentEvent) => {
      // Capture Claude Code's session ID from init event
      if (e.type === "init" && e.data?.sessionId && !session.ccSessionId) {
        session.ccSessionId = e.data.sessionId as string;
        this.persistSession(session);
      }
      // assistant_delta events are transient streaming chunks — exclude from buffer
      // so reconnecting clients don't replay hundreds of delta fragments
      if (e.type !== "assistant_delta") {
        session.eventBuffer.push(e);
        if (session.eventBuffer.length > MAX_EVENT_BUFFER) {
          session.eventBuffer.splice(0, session.eventBuffer.length - MAX_EVENT_BUFFER);
        }
      }
      session.eventCounter++;
      // Update session state based on event type
      if (e.type === "complete" || e.type === "error" || e.type === "interrupted") {
        this.setSessionState(sessionId, session, "waiting");
      }
      // Persist assistant messages to chat_messages
      this.persistEvent(sessionId, e);
      // Notify real-time listeners (WebSocket subscribers)
      const listeners = this.eventListeners.get(sessionId);
      if (listeners) {
        for (const cb of listeners) cb(session.eventCounter, e);
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
  pushEvent(sessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.eventBuffer.push(event);
    session.eventCounter++;
    if (session.eventBuffer.length > MAX_EVENT_BUFFER) {
      session.eventBuffer.splice(0, session.eventBuffer.length - MAX_EVENT_BUFFER);
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
  createPendingPermission(sessionId: string, request: Record<string, unknown>): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) this.setSessionState(sessionId, session, "permission");

    return new Promise<boolean>((resolve) => {
      const createdAt = Date.now();
      this.pendingPermissions.set(sessionId, { resolve, request, createdAt });
      // Notify permission subscribers (WS push)
      for (const cb of this.permissionRequestListeners) cb(sessionId, request, createdAt);
      // Auto-deny after timeout
      setTimeout(() => {
        if (this.pendingPermissions.has(sessionId)) {
          this.pendingPermissions.delete(sessionId);
          resolve(false);
        }
      }, PERMISSION_TIMEOUT_MS);
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

    // Merge: overrides win
    const config: StartConfig = {
      provider: overrides.provider ?? base.provider,
      model: overrides.model ?? base.model,
      permissionMode: overrides.permissionMode ?? base.permissionMode,
      extraArgs: overrides.extraArgs ?? base.extraArgs,
    };

    // Kill existing
    if (session.process?.alive) session.process.kill();
    session.eventBuffer.length = 0;

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
      session.lastStartConfig = { provider: "claude-code", model, permissionMode: "acceptEdits" };
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
      session.lastStartConfig = { provider: "claude-code", model: "claude-sonnet-4-6", permissionMode: mode };
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
  private getMessageStats(sessionId: string): { messageCount: number; lastMessage: { role: string; content: string; created_at: string } | null } {
    try {
      const db = getDb();
      const count = db.prepare(
        `SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?`
      ).get(sessionId) as { c: number };
      const last = db.prepare(
        `SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1`
      ).get(sessionId) as { role: string; content: string; created_at: string } | undefined;
      return {
        messageCount: count.c,
        lastMessage: last ? { role: last.role, content: last.content, created_at: last.created_at } : null,
      };
    } catch {
      return { messageCount: 0, lastMessage: null };
    }
  }

  private persistEvent(sessionId: string, e: AgentEvent): void {
    try {
      const db = getDb();
      switch (e.type) {
        case "assistant":
          if (e.message) {
            db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`)
              .run(sessionId, e.message);
          }
          break;
        case "thinking":
          if (e.message) {
            db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'thinking', ?)`)
              .run(sessionId, e.message);
          }
          break;
        case "tool_use": {
          const toolName = (e.data?.toolName as string) ?? e.message ?? "tool";
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'tool', ?, ?)`)
            .run(sessionId, toolName, JSON.stringify(e.data ?? {}));
          break;
        }
        case "tool_result":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'tool_result', ?, ?)`)
            .run(sessionId, e.message ?? "", JSON.stringify(e.data ?? {}));
          break;
        case "complete":
          // Turn-end metadata only — the text was already saved by the "assistant" event
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'status', '', ?)`)
            .run(sessionId, JSON.stringify({ status: "complete", ...e.data }));
          break;
        case "error":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'error', ?, ?)`)
            .run(sessionId, e.message ?? "Error", JSON.stringify({ status: "error" }));
          break;
      }
    } catch { /* DB failure is non-fatal */ }
  }

  /** Kill all sessions. Used during shutdown. */
  killAll(): void {
    for (const session of this.sessions.values()) {
      if (session.process?.alive) {
        session.process.kill();
      }
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
