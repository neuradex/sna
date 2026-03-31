import { getDb } from "../db/schema.js";
const DEFAULT_MAX_SESSIONS = 5;
const MAX_EVENT_BUFFER = 500;
const PERMISSION_TIMEOUT_MS = 3e5;
class SessionManager {
  constructor(options = {}) {
    this.sessions = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Map();
    this.pendingPermissions = /* @__PURE__ */ new Map();
    this.skillEventListeners = /* @__PURE__ */ new Set();
    this.permissionRequestListeners = /* @__PURE__ */ new Set();
    this.lifecycleListeners = /* @__PURE__ */ new Set();
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.restoreFromDb();
  }
  /** Restore session metadata from DB (cwd, label, meta). Process state is not restored. */
  restoreFromDb() {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, meta, cwd, created_at FROM chat_sessions`
      ).all();
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
          createdAt: new Date(row.created_at).getTime() || Date.now(),
          lastActivityAt: Date.now()
        });
      }
    } catch {
    }
  }
  /** Persist session metadata to DB. */
  persistSession(session) {
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR REPLACE INTO chat_sessions (id, label, type, meta, cwd) VALUES (?, ?, 'main', ?, ?)`
      ).run(session.id, session.label, session.meta ? JSON.stringify(session.meta) : null, session.cwd);
    } catch {
    }
  }
  /** Create a new session. Throws if max sessions reached. */
  createSession(opts = {}) {
    const id = opts.id ?? crypto.randomUUID().slice(0, 8);
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id);
      let changed = false;
      if (opts.cwd && opts.cwd !== existing.cwd) {
        existing.cwd = opts.cwd;
        changed = true;
      }
      if (opts.label && opts.label !== existing.label) {
        existing.label = opts.label;
        changed = true;
      }
      if (opts.meta !== void 0 && opts.meta !== existing.meta) {
        existing.meta = opts.meta ?? null;
        changed = true;
      }
      if (changed) this.persistSession(existing);
      return existing;
    }
    const aliveCount = Array.from(this.sessions.values()).filter((s) => s.process?.alive).length;
    if (aliveCount >= this.maxSessions) {
      throw new Error(`Max active sessions (${this.maxSessions}) reached \u2014 ${aliveCount} alive`);
    }
    const session = {
      id,
      process: null,
      eventBuffer: [],
      eventCounter: 0,
      label: opts.label ?? id,
      cwd: opts.cwd ?? process.cwd(),
      meta: opts.meta ?? null,
      state: "idle",
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };
    this.sessions.set(id, session);
    this.persistSession(session);
    return session;
  }
  /** Get a session by ID. */
  getSession(id) {
    return this.sessions.get(id);
  }
  /** Get or create a session (used for "default" backward compat). */
  getOrCreateSession(id, opts) {
    const existing = this.sessions.get(id);
    if (existing) {
      if (opts?.cwd && opts.cwd !== existing.cwd) {
        existing.cwd = opts.cwd;
        this.persistSession(existing);
      }
      return existing;
    }
    return this.createSession({ id, ...opts });
  }
  /** Set the agent process for a session. Subscribes to events. */
  setProcess(sessionId, proc) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    session.process = proc;
    session.state = "processing";
    session.lastActivityAt = Date.now();
    proc.on("event", (e) => {
      session.eventBuffer.push(e);
      session.eventCounter++;
      if (session.eventBuffer.length > MAX_EVENT_BUFFER) {
        session.eventBuffer.splice(0, session.eventBuffer.length - MAX_EVENT_BUFFER);
      }
      if (e.type === "complete" || e.type === "error") {
        session.state = "waiting";
      }
      this.persistEvent(sessionId, e);
      const listeners = this.eventListeners.get(sessionId);
      if (listeners) {
        for (const cb of listeners) cb(session.eventCounter, e);
      }
    });
    proc.on("exit", (code) => {
      session.state = "idle";
      this.emitLifecycle({ session: sessionId, state: code != null ? "exited" : "crashed", code });
    });
    proc.on("error", () => {
      session.state = "idle";
      this.emitLifecycle({ session: sessionId, state: "crashed" });
    });
    this.emitLifecycle({ session: sessionId, state: "started" });
  }
  // ── Event pub/sub (for WebSocket) ─────────────────────────────
  /** Subscribe to real-time events for a session. Returns unsubscribe function. */
  onSessionEvent(sessionId, cb) {
    let set = this.eventListeners.get(sessionId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.eventListeners.set(sessionId, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.eventListeners.delete(sessionId);
    };
  }
  // ── Skill event pub/sub ────────────────────────────────────────
  /** Subscribe to skill events broadcast. Returns unsubscribe function. */
  onSkillEvent(cb) {
    this.skillEventListeners.add(cb);
    return () => this.skillEventListeners.delete(cb);
  }
  /** Broadcast a skill event to all subscribers (called after DB insert). */
  broadcastSkillEvent(event) {
    for (const cb of this.skillEventListeners) cb(event);
  }
  // ── Permission pub/sub ────────────────────────────────────────
  /** Subscribe to permission request notifications. Returns unsubscribe function. */
  onPermissionRequest(cb) {
    this.permissionRequestListeners.add(cb);
    return () => this.permissionRequestListeners.delete(cb);
  }
  // ── Session lifecycle pub/sub ──────────────────────────────────
  /** Subscribe to session lifecycle events (started/killed/exited/crashed). Returns unsubscribe function. */
  onSessionLifecycle(cb) {
    this.lifecycleListeners.add(cb);
    return () => this.lifecycleListeners.delete(cb);
  }
  emitLifecycle(event) {
    for (const cb of this.lifecycleListeners) cb(event);
  }
  // ── Permission management ─────────────────────────────────────
  /** Create a pending permission request. Returns a promise that resolves when approved/denied. */
  createPendingPermission(sessionId, request) {
    const session = this.sessions.get(sessionId);
    if (session) session.state = "permission";
    return new Promise((resolve) => {
      const createdAt = Date.now();
      this.pendingPermissions.set(sessionId, { resolve, request, createdAt });
      for (const cb of this.permissionRequestListeners) cb(sessionId, request, createdAt);
      setTimeout(() => {
        if (this.pendingPermissions.has(sessionId)) {
          this.pendingPermissions.delete(sessionId);
          resolve(false);
        }
      }, PERMISSION_TIMEOUT_MS);
    });
  }
  /** Resolve a pending permission request. Returns false if no pending request. */
  resolvePendingPermission(sessionId, approved) {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending) return false;
    pending.resolve(approved);
    this.pendingPermissions.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) session.state = "processing";
    return true;
  }
  /** Get a pending permission for a specific session. */
  getPendingPermission(sessionId) {
    const p = this.pendingPermissions.get(sessionId);
    return p ? { request: p.request, createdAt: p.createdAt } : null;
  }
  /** Get all pending permissions across sessions. */
  getAllPendingPermissions() {
    return Array.from(this.pendingPermissions.entries()).map(([id, p]) => ({
      sessionId: id,
      request: p.request,
      createdAt: p.createdAt
    }));
  }
  // ── Session lifecycle ─────────────────────────────────────────
  /** Kill the agent process in a session (session stays, can be restarted). */
  /** Interrupt the current turn (SIGINT). Process stays alive, returns to waiting. */
  interruptSession(id) {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.interrupt();
    session.state = "waiting";
    return true;
  }
  /** Kill the agent process in a session (session stays, can be restarted). */
  killSession(id) {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.kill();
    this.emitLifecycle({ session: id, state: "killed" });
    return true;
  }
  /** Remove a session entirely. Cannot remove "default". */
  removeSession(id) {
    if (id === "default") return false;
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.kill();
    this.eventListeners.delete(id);
    this.pendingPermissions.delete(id);
    this.sessions.delete(id);
    return true;
  }
  /** List all sessions as serializable info objects. */
  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      label: s.label,
      alive: s.process?.alive ?? false,
      state: s.state,
      cwd: s.cwd,
      meta: s.meta,
      eventCount: s.eventCounter,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt
    }));
  }
  /** Touch a session's lastActivityAt timestamp. */
  touch(id) {
    const session = this.sessions.get(id);
    if (session) session.lastActivityAt = Date.now();
  }
  /** Persist an agent event to chat_messages. */
  persistEvent(sessionId, e) {
    try {
      const db = getDb();
      switch (e.type) {
        case "assistant":
          if (e.message) {
            db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`).run(sessionId, e.message);
          }
          break;
        case "thinking":
          if (e.message) {
            db.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'thinking', ?)`).run(sessionId, e.message);
          }
          break;
        case "tool_use": {
          const toolName = e.data?.toolName ?? e.message ?? "tool";
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'tool', ?, ?)`).run(sessionId, toolName, JSON.stringify(e.data ?? {}));
          break;
        }
        case "tool_result":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'tool_result', ?, ?)`).run(sessionId, e.message ?? "", JSON.stringify(e.data ?? {}));
          break;
        case "complete":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'status', '', ?)`).run(sessionId, JSON.stringify({ status: "complete", ...e.data }));
          break;
        case "error":
          db.prepare(`INSERT INTO chat_messages (session_id, role, content, meta) VALUES (?, 'error', ?, ?)`).run(sessionId, e.message ?? "Error", JSON.stringify({ status: "error" }));
          break;
      }
    } catch {
    }
  }
  /** Kill all sessions. Used during shutdown. */
  killAll() {
    for (const session of this.sessions.values()) {
      if (session.process?.alive) {
        session.process.kill();
      }
    }
  }
  get size() {
    return this.sessions.size;
  }
}
export {
  SessionManager
};
