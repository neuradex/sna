/**
 * runtime_sessions DAO.
 *
 * The table stores one row per spawn snapshot in the Session chain. Phase 4
 * adds the schema and these helpers; phase 5 (#21) wires SessionManager to
 * read/write through them instead of the legacy single-row
 * `chat_sessions.last_start_config`.
 *
 * Row shape:
 *   id              TEXT PRIMARY KEY               -- unique per spawn
 *   sna_session_id  TEXT NOT NULL                  -- FK chat_sessions(id)
 *   parent_id       TEXT NULL                      -- previous RT in chain
 *   config          TEXT NOT NULL                  -- JSON SessionConfig
 *   state           TEXT NOT NULL DEFAULT 'idle'   -- per-runtime state
 *   spawned_at      INTEGER NOT NULL
 *   retired_at      INTEGER NULL                   -- null = active
 *
 * Invariants:
 *   - At most one row per sna_session_id with retired_at IS NULL.
 *   - parent_id chain reaches a root (parent_id IS NULL) without cycles.
 *   - spawned_at strictly increases along the chain.
 */

import type Database from "better-sqlite3";
import type { SessionConfig, SessionState } from "../server/session-manager.js";

export interface RuntimeSessionRow {
  id: string;
  sna_session_id: string;
  parent_id: string | null;
  config: string; // JSON SessionConfig
  state: SessionState;
  spawned_at: number;
  retired_at: number | null;
}

export interface RuntimeSessionInsert {
  id: string;
  snaSessionId: string;
  parentId: string | null;
  config: SessionConfig;
  state?: SessionState;
  spawnedAt?: number;
}

export function insertRuntimeSession(db: Database.Database, input: RuntimeSessionInsert): void {
  db.prepare(
    `INSERT INTO runtime_sessions
       (id, sna_session_id, parent_id, config, state, spawned_at, retired_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.id,
    input.snaSessionId,
    input.parentId,
    JSON.stringify(input.config),
    input.state ?? "idle",
    input.spawnedAt ?? Date.now(),
  );
}

/** Stamp `retired_at` on a runtime — marks it as no-longer-active. */
export function retireRuntimeSession(db: Database.Database, id: string, retiredAt = Date.now()): void {
  db.prepare(
    `UPDATE runtime_sessions SET retired_at = ? WHERE id = ? AND retired_at IS NULL`,
  ).run(retiredAt, id);
}

/** Update a runtime's persisted state (idle / processing / waiting / permission). */
export function setRuntimeState(db: Database.Database, id: string, state: SessionState): void {
  db.prepare(`UPDATE runtime_sessions SET state = ? WHERE id = ?`).run(state, id);
}

/** Replace the stored config JSON for a runtime — used by setSessionModel-style
 *  in-place mutators that don't create a new chain node. */
export function updateRuntimeConfig(db: Database.Database, id: string, config: SessionConfig): void {
  db.prepare(`UPDATE runtime_sessions SET config = ? WHERE id = ?`).run(JSON.stringify(config), id);
}

export function getRuntimeSession(db: Database.Database, id: string): RuntimeSessionRow | null {
  const row = db.prepare(`SELECT * FROM runtime_sessions WHERE id = ?`).get(id) as RuntimeSessionRow | undefined;
  return row ?? null;
}

/** Return the active runtime for a session, or null if none recorded yet. */
export function getCurrentRuntime(db: Database.Database, snaSessionId: string): RuntimeSessionRow | null {
  const row = db.prepare(
    `SELECT * FROM runtime_sessions
      WHERE sna_session_id = ? AND retired_at IS NULL
      ORDER BY spawned_at DESC LIMIT 1`,
  ).get(snaSessionId) as RuntimeSessionRow | undefined;
  return row ?? null;
}

/** Return all runtimes for a session, oldest first (chain order). */
export function listRuntimeSessions(db: Database.Database, snaSessionId: string): RuntimeSessionRow[] {
  return db.prepare(
    `SELECT * FROM runtime_sessions WHERE sna_session_id = ? ORDER BY spawned_at ASC`,
  ).all(snaSessionId) as RuntimeSessionRow[];
}
