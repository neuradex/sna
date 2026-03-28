import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import path from "path";

// sna-core is symlinked in dev (node_modules/sna → ../../sna/sna-core).
// Node resolves native modules from the script's physical location (sna-core/),
// but better-sqlite3's native binary is only built in the consumer app's node_modules.
// Fix: always resolve better-sqlite3 from cwd (= consumer app root).
const require = createRequire(path.join(process.cwd(), "node_modules", "_"));
const BetterSqlite3: typeof Database = require("better-sqlite3");

const DB_PATH = path.join(process.cwd(), "data/app.db");

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
    CREATE TABLE IF NOT EXISTS skill_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      skill      TEXT NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      data       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill);
    CREATE INDEX IF NOT EXISTS idx_skill_events_created ON skill_events(created_at);
  `);
}

export interface SkillEvent {
  id: number;
  skill: string;
  type: "invoked" | "called" | "success" | "failed" | "permission_needed"
      | "start" | "progress" | "milestone" | "complete" | "error";
  message: string;
  data: string | null;
  created_at: string;
}
