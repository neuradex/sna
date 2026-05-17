import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import fs from "fs";
import path from "path";

function getDbPath(): string {
  return process.env.SNA_DB_PATH ?? path.join(process.cwd(), "data/sna.db");
}

/**
 * Legacy isolated native deps directory used by older builds.
 * Newer builds prefer `nativeBinding` passed via `startSnaServer()`,
 * but we still check this path for backward compatibility.
 */
const NATIVE_DIR = path.join(process.cwd(), ".sna/native");

let _db: Database.Database | null = null;

/**
 * Load better-sqlite3 (peer dependency — installed by consumer).
 *
 * Resolution order:
 *   1. SNA_MODULES_PATH env — consumer's node_modules (set by Electron launcher for link: dev)
 *   2. .sna/native/ — legacy isolated copy left by older builds
 *   3. Standard resolution — peer dep in consumer's node_modules (published install)
 */
function loadBetterSqlite3(): typeof Database {
  const modulesPath = process.env.SNA_MODULES_PATH;
  if (modulesPath) {
    const entry = path.join(modulesPath, "better-sqlite3");
    if (fs.existsSync(entry)) {
      const req = createRequire(path.join(modulesPath, "noop.js"));
      return req("better-sqlite3");
    }
  }

  const nativeEntry = path.join(NATIVE_DIR, "node_modules", "better-sqlite3");
  if (fs.existsSync(nativeEntry)) {
    const req = createRequire(path.join(NATIVE_DIR, "noop.js"));
    return req("better-sqlite3");
  }
  const req = createRequire(import.meta.url);
  return req("better-sqlite3");
}

export function getDb(): Database.Database {
  if (!_db) {
    const BetterSqlite3 = loadBetterSqlite3();
    const dir = path.dirname(getDbPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const nativeBinding = process.env.SNA_SQLITE_NATIVE_BINDING || undefined;
    _db = nativeBinding ? new BetterSqlite3(getDbPath(), { nativeBinding }) : new BetterSqlite3(getDbPath());
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
  }
  return _db;
}

/** Reset the DB singleton cache. Used by tests for isolation. */
export function resetDb(): void {
  _db = null;
}

/** Drop the legacy skill_events table from older databases. */
function dropLegacySkillEvents(db: Database.Database) {
  db.exec("DROP TABLE IF EXISTS skill_events");
}

function migrateChatSessionsMeta(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "meta")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN meta TEXT");
  }
  if (cols.length > 0 && !cols.some((c) => c.name === "cwd")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN cwd TEXT");
  }
  if (cols.length > 0 && !cols.some((c) => c.name === "last_start_config")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN last_start_config TEXT");
  }
}

/**
 * Migrate chat_messages from the legacy single-column `role` model to the
 * canonical two-column (actor, kind) model.
 *
 * The legacy `role` column conflated two orthogonal axes — WHO produced the
 * block and WHAT kind of block it is. The new shape separates them and drops
 * the `role` column entirely. Consumers must read (actor, kind).
 *
 * Also moves legacy `meta.images[]` filenames into the `embeds` JSON column
 * with inline `![](embed://<id>)` refs appended to `content`.
 */
function migrateChatMessagesCanonical(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[];
  if (cols.length === 0) return; // Fresh DB — table will be created with the new shape.

  const hasRole = cols.some((c) => c.name === "role");
  const hasActor = cols.some((c) => c.name === "actor");
  const hasKind = cols.some((c) => c.name === "kind");
  const hasEmbeds = cols.some((c) => c.name === "embeds");
  const hasUpdatedAt = cols.some((c) => c.name === "updated_at");

  if (!hasRole && hasActor && hasKind && hasEmbeds && hasUpdatedAt) return; // Fully migrated.

  db.transaction(() => {
    if (!hasActor) db.exec("ALTER TABLE chat_messages ADD COLUMN actor TEXT");
    if (!hasKind) db.exec("ALTER TABLE chat_messages ADD COLUMN kind TEXT");
    if (!hasEmbeds) db.exec("ALTER TABLE chat_messages ADD COLUMN embeds TEXT");
    if (!hasUpdatedAt) db.exec("ALTER TABLE chat_messages ADD COLUMN updated_at TEXT");

    if (hasRole) {
      // Backfill (actor, kind) from legacy role values before dropping the column.
      db.exec(`
        UPDATE chat_messages SET
          actor = CASE role
            WHEN 'user' THEN 'user'
            WHEN 'assistant' THEN 'assistant'
            WHEN 'thinking' THEN 'assistant'
            WHEN 'tool' THEN 'assistant'
            WHEN 'tool_use' THEN 'assistant'
            WHEN 'tool_result' THEN 'system'
            WHEN 'status' THEN 'system'
            WHEN 'error' THEN 'system'
            ELSE 'system'
          END,
          kind = CASE role
            WHEN 'user' THEN 'text'
            WHEN 'assistant' THEN 'text'
            WHEN 'thinking' THEN 'thinking'
            WHEN 'tool' THEN 'tool_use'
            WHEN 'tool_use' THEN 'tool_use'
            WHEN 'tool_result' THEN 'tool_result'
            WHEN 'status' THEN 'status'
            WHEN 'error' THEN 'error'
            ELSE 'text'
          END
        WHERE actor IS NULL OR kind IS NULL;
      `);
    }

    // Backfill updated_at from created_at (pre-migration rows were never updated in place).
    db.exec(`UPDATE chat_messages SET updated_at = created_at WHERE updated_at IS NULL`);

    // Migrate legacy meta.images[] into embeds column + inline embed refs in content.
    const legacyImageRows = db.prepare(`
      SELECT id, content, meta FROM chat_messages
      WHERE meta IS NOT NULL AND meta LIKE '%"images"%' AND embeds IS NULL
    `).all() as { id: number; content: string; meta: string }[];

    const updateEmbeds = db.prepare(`UPDATE chat_messages SET content = ?, embeds = ?, meta = ? WHERE id = ?`);
    for (const row of legacyImageRows) {
      try {
        const meta = JSON.parse(row.meta) as Record<string, unknown>;
        const files = Array.isArray(meta.images) ? (meta.images as unknown[]).filter((f): f is string => typeof f === "string") : [];
        if (files.length === 0) continue;

        const embedEntries: Record<string, { mime_type: string; path: string }> = {};
        const refsSuffix: string[] = [];
        for (const filename of files) {
          const id = filename.replace(/\.[^.]+$/, "");
          const ext = filename.match(/\.([^.]+)$/)?.[1] ?? "";
          embedEntries[id] = { mime_type: extToMime(ext), path: filename };
          refsSuffix.push(`![](embed://${id})`);
        }
        const newContent = row.content + (refsSuffix.length > 0 ? "\n" + refsSuffix.join(" ") : "");
        delete meta.images;
        const newMeta = Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
        updateEmbeds.run(newContent, JSON.stringify(embedEntries), newMeta, row.id);
      } catch { /* malformed row — leave as-is */ }
    }

    // Drop the legacy role column. SQLite supports DROP COLUMN since 3.35.
    if (hasRole) {
      db.exec("ALTER TABLE chat_messages DROP COLUMN role");
    }
  })();
}

/** Drop the legacy skill_name column (skills are no longer first-class in the schema). */
function migrateDropSkillName(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[];
  if (cols.length === 0) return;
  if (cols.some((c) => c.name === "skill_name")) {
    db.exec("ALTER TABLE chat_messages DROP COLUMN skill_name");
  }
}

function extToMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

/**
 * Add `current_runtime_id` + `cc_session_id` to chat_sessions, and create
 * `runtime_sessions`. Backfill: every chat_sessions row with a
 * last_start_config gets one runtime_sessions entry (parentId null, current),
 * and chat_sessions.current_runtime_id is pointed at it.
 *
 * Phase 5 of the session-model refactor (#21) wires SessionManager to read
 * from runtime_sessions. Phase 4 (this code) is additive: the old
 * `last_start_config` / `cwd` columns continue to be written for backward
 * compat until phase 5 lands.
 */
function migrateRuntimeSessions(db: Database.Database) {
  // Idempotent: skip if the table already exists with the expected shape.
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_sessions'",
  ).all() as { name: string }[];
  const tableExists = tables.length > 0;

  // Columns to add to chat_sessions (idempotent).
  const cols = db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
  const hasCurrentRuntime = cols.some((c) => c.name === "current_runtime_id");
  const hasCcSession = cols.some((c) => c.name === "cc_session_id");

  db.transaction(() => {
    if (!hasCurrentRuntime) {
      db.exec("ALTER TABLE chat_sessions ADD COLUMN current_runtime_id TEXT");
    }
    if (!hasCcSession) {
      db.exec("ALTER TABLE chat_sessions ADD COLUMN cc_session_id TEXT");
    }

    if (!tableExists) {
      db.exec(`
        CREATE TABLE runtime_sessions (
          id              TEXT PRIMARY KEY,
          sna_session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
          parent_id       TEXT REFERENCES runtime_sessions(id),
          config          TEXT NOT NULL,
          state           TEXT NOT NULL DEFAULT 'idle',
          spawned_at      INTEGER NOT NULL,
          retired_at      INTEGER
        );
        CREATE INDEX idx_runtime_sessions_sna ON runtime_sessions(sna_session_id);
        CREATE INDEX idx_runtime_sessions_parent ON runtime_sessions(parent_id);
        CREATE INDEX idx_runtime_sessions_alive ON runtime_sessions(sna_session_id)
          WHERE retired_at IS NULL;
      `);
    }

    // Backfill: every chat_sessions row that has a recorded config gets a
    // runtime_sessions entry. Idempotent: only insert when there's no
    // existing runtime for that session.
    const sessions = db.prepare(
      `SELECT id, cwd, last_start_config, current_runtime_id
         FROM chat_sessions
        WHERE last_start_config IS NOT NULL`,
    ).all() as { id: string; cwd: string | null; last_start_config: string; current_runtime_id: string | null }[];

    const insertRT = db.prepare(
      `INSERT INTO runtime_sessions
         (id, sna_session_id, parent_id, config, state, spawned_at, retired_at)
       VALUES (?, ?, NULL, ?, 'idle', ?, NULL)`,
    );
    const linkCurrent = db.prepare(
      `UPDATE chat_sessions SET current_runtime_id = ? WHERE id = ?`,
    );

    for (const row of sessions) {
      if (row.current_runtime_id) continue; // already migrated
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(row.last_start_config) as Record<string, unknown>;
      } catch {
        continue; // malformed — skip; SessionManager will re-create on next start
      }
      // Ensure cwd is present in the new config JSON. Falls back to the
      // legacy chat_sessions.cwd column, then the empty string.
      if (typeof config.cwd !== "string") {
        config.cwd = row.cwd ?? "";
      }
      const rtId = `rt_${row.id}_${Date.now().toString(36)}`;
      insertRT.run(rtId, row.id, JSON.stringify(config), Date.now());
      linkCurrent.run(rtId, row.id);
    }
  })();
}

function initSchema(db: Database.Database) {
  dropLegacySkillEvents(db);
  migrateChatSessionsMeta(db);
  migrateChatMessagesCanonical(db);
  migrateDropSkillName(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'main',
      meta       TEXT,
      cwd        TEXT,
      last_start_config TEXT,
      current_runtime_id TEXT,
      cc_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Ensure default session always exists
    INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES ('default', 'Chat', 'main');

    -- Canonical chat_messages schema. Two orthogonal axes describe each block:
    --   actor  WHO produced it:    'user' | 'assistant' | 'system'
    --   kind   WHAT kind it is:    'text' | 'thinking' | 'tool_use' | 'tool_result' | 'status' | 'error'
    --   content Textual body. May contain inline embed refs: ![](embed://<id>)
    --   embeds  JSON { "<id>": { mime_type, path, ... } } — binary attachments referenced by content.
    --   meta    Kind-specific structured overlay (usage, tool_use_id, input JSON, isError, ...)
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      actor      TEXT NOT NULL DEFAULT 'user',
      kind       TEXT NOT NULL DEFAULT 'text',
      content    TEXT NOT NULL DEFAULT '',
      embeds     TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runtime_sessions (
      id              TEXT PRIMARY KEY,
      sna_session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      parent_id       TEXT REFERENCES runtime_sessions(id),
      config          TEXT NOT NULL,
      state           TEXT NOT NULL DEFAULT 'idle',
      spawned_at      INTEGER NOT NULL,
      retired_at      INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_kind ON chat_messages(session_id, kind);
    CREATE INDEX IF NOT EXISTS idx_runtime_sessions_sna ON runtime_sessions(sna_session_id);
    CREATE INDEX IF NOT EXISTS idx_runtime_sessions_parent ON runtime_sessions(parent_id);
    CREATE INDEX IF NOT EXISTS idx_runtime_sessions_alive ON runtime_sessions(sna_session_id)
      WHERE retired_at IS NULL;
  `);

  // Backfill must run after chat_sessions / runtime_sessions exist.
  migrateRuntimeSessions(db);
}

export interface ChatSession {
  id: string;
  label: string;
  type: "main" | "background";
  meta: string | null;
  cwd: string | null;
  created_at: string;
}

/** Block actor — who produced the content. */
export type ChatActor = "user" | "assistant" | "system";

/** Block kind — what kind of content. Valid (actor, kind) pairs enforced at write time. */
export type ChatKind = "text" | "thinking" | "tool_use" | "tool_result" | "status" | "error";

export interface ChatMessage {
  id: number;
  session_id: string;
  actor: ChatActor;
  kind: ChatKind;
  content: string;
  /** JSON: { "<embedId>": { mime_type: string; path: string; ... } }. Null if no attachments. */
  embeds: string | null;
  meta: string | null;
  created_at: string;
  updated_at: string;
}
