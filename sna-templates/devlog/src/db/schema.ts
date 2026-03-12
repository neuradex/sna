import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../../data/devlog.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
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
    CREATE TABLE IF NOT EXISTS commits (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hash          TEXT UNIQUE NOT NULL,
      date          TEXT NOT NULL,
      time          TEXT NOT NULL,
      message       TEXT NOT NULL,
      repo          TEXT NOT NULL,
      files_changed INTEGER DEFAULT 0,
      insertions    INTEGER DEFAULT 0,
      deletions     INTEGER DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(date);
    CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo);

    CREATE TABLE IF NOT EXISTS analysis_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL DEFAULT (date('now')),
      note       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

export interface Commit {
  id: number;
  hash: string;
  date: string;
  time: string;
  message: string;
  repo: string;
  files_changed: number;
  insertions: number;
  deletions: number;
  created_at: string;
}

export interface AnalysisNote {
  id: number;
  date: string;
  note: string;
  created_at: string;
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

// For legacy compatibility
export type Entry = Commit;
