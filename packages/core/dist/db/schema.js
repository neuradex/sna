import { createRequire } from "node:module";
import fs from "fs";
import path from "path";
function getDbPath() {
  return process.env.SNA_DB_PATH ?? path.join(process.cwd(), "data/sna.db");
}
const NATIVE_DIR = path.join(process.cwd(), ".sna/native");
let _db = null;
function loadBetterSqlite3() {
  const modulesPath = process.env.SNA_MODULES_PATH;
  if (modulesPath) {
    const entry = path.join(modulesPath, "better-sqlite3");
    if (fs.existsSync(entry)) {
      const req2 = createRequire(path.join(modulesPath, "noop.js"));
      return req2("better-sqlite3");
    }
  }
  const nativeEntry = path.join(NATIVE_DIR, "node_modules", "better-sqlite3");
  if (fs.existsSync(nativeEntry)) {
    const req2 = createRequire(path.join(NATIVE_DIR, "noop.js"));
    return req2("better-sqlite3");
  }
  const req = createRequire(import.meta.url);
  return req("better-sqlite3");
}
function getDb() {
  if (!_db) {
    const BetterSqlite3 = loadBetterSqlite3();
    const dir = path.dirname(getDbPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const nativeBinding = process.env.SNA_SQLITE_NATIVE_BINDING || void 0;
    _db = nativeBinding ? new BetterSqlite3(getDbPath(), { nativeBinding }) : new BetterSqlite3(getDbPath());
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
  }
  return _db;
}
function dropLegacySkillEvents(db) {
  db.exec("DROP TABLE IF EXISTS skill_events");
}
function migrateChatSessionsMeta(db) {
  const cols = db.prepare("PRAGMA table_info(chat_sessions)").all();
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
function migrateChatMessagesCanonical(db) {
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all();
  if (cols.length === 0) return;
  const hasRole = cols.some((c) => c.name === "role");
  const hasActor = cols.some((c) => c.name === "actor");
  const hasKind = cols.some((c) => c.name === "kind");
  const hasEmbeds = cols.some((c) => c.name === "embeds");
  const hasUpdatedAt = cols.some((c) => c.name === "updated_at");
  if (!hasRole && hasActor && hasKind && hasEmbeds && hasUpdatedAt) return;
  db.transaction(() => {
    if (!hasActor) db.exec("ALTER TABLE chat_messages ADD COLUMN actor TEXT");
    if (!hasKind) db.exec("ALTER TABLE chat_messages ADD COLUMN kind TEXT");
    if (!hasEmbeds) db.exec("ALTER TABLE chat_messages ADD COLUMN embeds TEXT");
    if (!hasUpdatedAt) db.exec("ALTER TABLE chat_messages ADD COLUMN updated_at TEXT");
    if (hasRole) {
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
    db.exec(`UPDATE chat_messages SET updated_at = created_at WHERE updated_at IS NULL`);
    const legacyImageRows = db.prepare(`
      SELECT id, content, meta FROM chat_messages
      WHERE meta IS NOT NULL AND meta LIKE '%"images"%' AND embeds IS NULL
    `).all();
    const updateEmbeds = db.prepare(`UPDATE chat_messages SET content = ?, embeds = ?, meta = ? WHERE id = ?`);
    for (const row of legacyImageRows) {
      try {
        const meta = JSON.parse(row.meta);
        const files = Array.isArray(meta.images) ? meta.images.filter((f) => typeof f === "string") : [];
        if (files.length === 0) continue;
        const embedEntries = {};
        const refsSuffix = [];
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
      } catch {
      }
    }
    if (hasRole) {
      db.exec("ALTER TABLE chat_messages DROP COLUMN role");
    }
  })();
}
function migrateDropSkillName(db) {
  const cols = db.prepare("PRAGMA table_info(chat_messages)").all();
  if (cols.length === 0) return;
  if (cols.some((c) => c.name === "skill_name")) {
    db.exec("ALTER TABLE chat_messages DROP COLUMN skill_name");
  }
}
function extToMime(ext) {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
function initSchema(db) {
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Ensure default session always exists
    INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES ('default', 'Chat', 'main');

    -- Canonical chat_messages schema. Two orthogonal axes describe each block:
    --   actor  WHO produced it:    'user' | 'assistant' | 'system'
    --   kind   WHAT kind it is:    'text' | 'thinking' | 'tool_use' | 'tool_result' | 'status' | 'error'
    --   content Textual body. May contain inline embed refs: ![](embed://<id>)
    --   embeds  JSON { "<id>": { mime_type, path, ... } } \u2014 binary attachments referenced by content.
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

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_kind ON chat_messages(session_id, kind);
  `);
}
export {
  getDb
};
