import { createRequire } from "node:module";
import path from "path";
const require2 = createRequire(path.join(process.cwd(), "node_modules", "_"));
const BetterSqlite3 = require2("better-sqlite3");
const DB_PATH = path.join(process.cwd(), "data/sna.db");
let _db = null;
function getDb() {
  if (!_db) {
    _db = new BetterSqlite3(DB_PATH);
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
  }
  return _db;
}
function migrateSkillEvents(db) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='skill_events'"
  ).get();
  if (row?.sql?.includes("CHECK(type IN")) {
    db.exec("DROP TABLE IF EXISTS skill_events");
  }
}
function initSchema(db) {
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
export {
  getDb
};
