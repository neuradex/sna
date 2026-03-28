import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import path from "path";

// sna-core is symlinked in dev (node_modules/sna → ../../sna/sna-core).
// Node resolves native modules from the script's physical location (sna-core/),
// but better-sqlite3's native binary is only built in the consumer app's node_modules.
// Fix: always resolve better-sqlite3 from cwd (= consumer app root).
const require = createRequire(path.join(process.cwd(), "node_modules", "_"));
const BetterSqlite3: typeof Database = require("better-sqlite3");

const DB_PATH = path.join(process.cwd(), "data/sna.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new BetterSqlite3(DB_PATH);
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

function initSchema(db: Database.Database) {
  migrateSkillEvents(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'main',
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
