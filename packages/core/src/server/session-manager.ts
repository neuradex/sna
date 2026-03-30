/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

import type { AgentProcess, AgentEvent } from "../core/providers/types.js";
import { getDb } from "../db/schema.js";

export type SessionState = "idle" | "processing" | "waiting" | "permission";

export interface Session {
  id: string;
  process: AgentProcess | null;
  eventBuffer: AgentEvent[];
  eventCounter: number;
  label: string;
  cwd: string;
  state: SessionState;
  createdAt: number;
  lastActivityAt: number;
}

export interface SessionInfo {
  id: string;
  label: string;
  alive: boolean;
  state: SessionState;
  cwd: string;
  eventCount: number;
  createdAt: number;
  lastActivityAt: number;
}

export interface SessionManagerOptions {
  maxSessions?: number;
}

const DEFAULT_MAX_SESSIONS = 5;
const MAX_EVENT_BUFFER = 500;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private maxSessions: number;

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  /** Create a new session. Throws if max sessions reached. */
  createSession(opts: {
    id?: string;
    label?: string;
    cwd?: string;
  } = {}): Session {
    const id = opts.id ?? crypto.randomUUID().slice(0, 8);

    if (this.sessions.has(id)) {
      return this.sessions.get(id)!;
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
      state: "idle",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.sessions.set(id, session);
    return session;
  }

  /** Get a session by ID. */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Get or create a session (used for "default" backward compat). */
  getOrCreateSession(id: string, opts?: { label?: string; cwd?: string }): Session {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    return this.createSession({ id, ...opts });
  }

  /** Set the agent process for a session. Subscribes to events. */
  setProcess(sessionId: string, proc: AgentProcess): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    session.process = proc;
    session.state = "processing";
    session.lastActivityAt = Date.now();

    proc.on("event", (e: AgentEvent) => {
      session.eventBuffer.push(e);
      session.eventCounter++;
      if (session.eventBuffer.length > MAX_EVENT_BUFFER) {
        session.eventBuffer.splice(0, session.eventBuffer.length - MAX_EVENT_BUFFER);
      }
      // Update session state based on event type
      if (e.type === "complete" || e.type === "error") {
        session.state = "waiting";
      }
      // Persist assistant messages to chat_messages
      this.persistEvent(sessionId, e);
    });
  }

  /** Kill the agent process in a session (session stays, can be restarted). */
  killSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.kill();
    return true;
  }

  /** Remove a session entirely. Cannot remove "default". */
  removeSession(id: string): boolean {
    if (id === "default") return false;
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.kill();
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
      cwd: s.cwd,
      eventCount: s.eventCounter,
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
