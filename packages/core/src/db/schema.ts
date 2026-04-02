import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.SNA_DB_PATH ?? path.join(process.cwd(), "data/sna.db");

/**
 * Directory for isolated native dependencies.
 * `sna api:up` installs better-sqlite3 here, outside the host app's
 * node_modules tree. This prevents electron-rebuild from clobbering
 * the binary — the SNA API server always uses system Node.js.
 */
const NATIVE_DIR = path.join(process.cwd(), ".sna/native");

let _db: Database.Database | null = null;

/**
 * Load better-sqlite3 from the isolated .sna/native/ directory.
 * Falls back to SDK's own node_modules only if .sna/native/ doesn't exist
 * (e.g., during SDK development or `pnpm build`).
 */
function loadBetterSqlite3(): typeof Database {
  const nativeEntry = path.join(NATIVE_DIR, "node_modules", "better-sqlite3");
  if (fs.existsSync(nativeEntry)) {
    const req = createRequire(path.join(NATIVE_DIR, "noop.js"));
    return req("better-sqlite3");
  }
  // Fallback for SDK development (no .sna/native/) or DB init scripts
  const req = createRequire(import.meta.url);
  return req("better-sqlite3");
}

export function getDb(): Database.Database {
  if (!_db) {
    const BetterSqlite3 = loadBetterSqlite3();
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // SNA_SQLITE_NATIVE_BINDING: bypass the 'bindings' package for native module resolution.
    // Required in Electron packaged apps where 'bindings' cannot traverse the asar bundle.
    // Set to the absolute path of the better_sqlite3.node file.
    const nativeBinding = process.env.SNA_SQLITE_NATIVE_BINDING || undefined;
    _db = nativeBinding ? new BetterSqlite3(DB_PATH, { nativeBinding }) : new BetterSqlite3(DB_PATH);
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

function initSchema(db: Database.Database) {
  migrateSkillEvents(db);
  migrateChatSessionsMeta(db);
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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      skill_name TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

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

export interface ChatMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  skill_name: string | null;
  meta: string | null;
  created_at: string;
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
