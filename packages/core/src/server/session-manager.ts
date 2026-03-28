/**
 * SessionManager — manages multiple independent agent sessions.
 *
 * Each session owns its own AgentProcess, event buffer, and cursor.
 * The default "default" session provides backward compatibility.
 */

import type { AgentProcess, AgentEvent } from "../core/providers/types.js";

export interface Session {
  id: string;
  process: AgentProcess | null;
  eventBuffer: AgentEvent[];
  eventCounter: number;
  label: string;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
}

export interface SessionInfo {
  id: string;
  label: string;
  alive: boolean;
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

    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Max sessions (${this.maxSessions}) reached`);
    }

    const session: Session = {
      id,
      process: null,
      eventBuffer: [],
      eventCounter: 0,
      label: opts.label ?? id,
      cwd: opts.cwd ?? process.cwd(),
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
    session.lastActivityAt = Date.now();

    proc.on("event", (e: AgentEvent) => {
      session.eventBuffer.push(e);
      session.eventCounter++;
      if (session.eventBuffer.length > MAX_EVENT_BUFFER) {
        session.eventBuffer.splice(0, session.eventBuffer.length - MAX_EVENT_BUFFER);
      }
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
