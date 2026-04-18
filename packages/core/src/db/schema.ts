import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import fs from "fs";
import path from "path";

function getDbPath(): string {
  return process.env.SNA_DB_PATH ?? path.join(process.cwd(), "data/sna.db");
}

/**
 * Directory for isolated native dependencies.
 * `sna api:up` installs better-sqlite3 here, outside the host app's
 * node_modules tree. This prevents electron-rebuild from clobbering
 * the binary — the SNA API server always uses system Node.js.
 */
const NATIVE_DIR = path.join(process.cwd(), ".sna/native");

let _db: Database.Database | null = null;

/**
 * Load better-sqlite3 (peer dependency — installed by consumer).
 *
 * Resolution order:
 *   1. SNA_MODULES_PATH env — consumer's node_modules (set by Electron launcher for link: dev)
 *   2. .sna/native/ — isolated copy installed by `sna api:up` (legacy)
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

function migrateSkillEvents(db: Database.Database) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='skill_events'"
  ).get() as { sql: string } | null;
  // Old schema had a CHECK constraint with only 5 types — drop and recreate
  if (row?.sql?.includes("CHECK(type IN")) {
    db.exec("DROP TABLE IF EXISTS skill_events");
  }
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

function initSchema(db: Database.Database) {
  migrateSkillEvents(db);
  migrateChatSessionsMeta(db);
  migrateChatMessagesCanonical(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'main',
      meta       TEXT,
      cwd        TEXT,
      last_start_config TEXT,
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
      skill_name TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_kind ON chat_messages(session_id, kind);

    CREATE TABLE IF NOT EXISTS skill_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      skill      TEXT NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      data       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill);
    CREATE INDEX IF NOT EXISTS idx_skill_events_created ON skill_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_events_session ON skill_events(session_id);
  `);
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
  skill_name: string | null;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillEvent {
  id: number;
  session_id: string | null;
  skill: string;
  type: "invoked" | "called" | "success" | "failed" | "permission_needed"
      | "start" | "progress" | "milestone" | "complete" | "error";
  message: string;
  data: string | null;
  created_at: string;
}
