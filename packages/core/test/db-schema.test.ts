/**
 * DB schema tests — verify tables, columns, migrations, and constraints.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const TEST_DB_DIR = path.join(import.meta.dirname, "../.test-data-schema");

function setup() {
  if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  const origCwd = process.cwd;
  process.cwd = () => TEST_DB_DIR;
  return () => { process.cwd = origCwd; fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); };
}

describe("DB Schema", () => {
  let cleanup: () => void;
  beforeEach(() => { cleanup = setup(); });
  afterEach(() => { cleanup?.(); });

  it("creates all three tables", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name).filter(n => !n.startsWith("sqlite_"));
    assert.ok(names.includes("chat_sessions"), "chat_sessions table");
    assert.ok(names.includes("chat_messages"), "chat_messages table");
    assert.ok(names.includes("skill_events"), "skill_events table");
  });

  it("chat_sessions has all columns including new ones", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
    const names = cols.map(c => c.name);
    for (const col of ["id", "label", "type", "meta", "cwd", "last_start_config", "created_at"]) {
      assert.ok(names.includes(col), `chat_sessions should have column: ${col}`);
    }
  });

  it("chat_messages has all columns", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[];
    const names = cols.map(c => c.name);
    for (const col of ["id", "session_id", "role", "content", "skill_name", "meta", "created_at"]) {
      assert.ok(names.includes(col), `chat_messages should have column: ${col}`);
    }
  });

  it("skill_events has all columns", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(skill_events)").all() as { name: string }[];
    const names = cols.map(c => c.name);
    for (const col of ["id", "session_id", "skill", "type", "message", "data", "created_at"]) {
      assert.ok(names.includes(col), `skill_events should have column: ${col}`);
    }
  });

  it("default session exists", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    const row = db.prepare("SELECT * FROM chat_sessions WHERE id = 'default'").get() as any;
    assert.ok(row, "default session should exist");
    assert.equal(row.label, "Chat");
  });

  it("chat_messages CASCADE does NOT fire on upsert", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();

    // Enable foreign keys
    db.pragma("foreign_keys = ON");

    // Insert session + message
    db.prepare("INSERT INTO chat_sessions (id, label) VALUES ('cascade-test', 'Test')").run();
    db.prepare("INSERT INTO chat_messages (session_id, role, content) VALUES ('cascade-test', 'user', 'hello')").run();

    // Upsert session (simulating persistSession)
    db.prepare(`
      INSERT INTO chat_sessions (id, label, type, meta, cwd, last_start_config)
      VALUES ('cascade-test', 'Updated', 'main', NULL, '/new', NULL)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, cwd = excluded.cwd
    `).run();

    const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = 'cascade-test'").get() as any;
    assert.equal(count.c, 1, "Message should survive upsert");
  });

  it("chat_messages CASCADE fires on actual DELETE", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    db.pragma("foreign_keys = ON");

    db.prepare("INSERT INTO chat_sessions (id, label) VALUES ('del-test', 'Test')").run();
    db.prepare("INSERT INTO chat_messages (session_id, role, content) VALUES ('del-test', 'user', 'hello')").run();
    db.prepare("DELETE FROM chat_sessions WHERE id = 'del-test'").run();

    const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = 'del-test'").get() as any;
    assert.equal(count.c, 0, "Messages should be deleted on session DELETE");
  });

  it("indexes exist", async () => {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    const names = indexes.map(i => i.name);
    assert.ok(names.includes("idx_chat_messages_session"));
    assert.ok(names.includes("idx_skill_events_skill"));
    assert.ok(names.includes("idx_skill_events_created"));
    assert.ok(names.includes("idx_skill_events_session"));
  });
});
