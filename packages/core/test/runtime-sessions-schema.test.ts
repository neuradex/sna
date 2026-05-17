/**
 * runtime_sessions schema + migration backfill.
 *
 * Phase 4 of #21 introduces a new table that holds one row per spawn snapshot
 * (config, state, parent link). Existing databases with a populated
 * `chat_sessions.last_start_config` must be backfilled into the new table so
 * phase 5's SessionManager rewrite can read from it without losing pre-PR
 * sessions.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { resetDb, getDb } from "../src/db/schema.js";

function setDbPath(p: string): void {
  process.env.SNA_DB_PATH = p;
}
import {
  insertRuntimeSession,
  retireRuntimeSession,
  setRuntimeState,
  updateRuntimeConfig,
  getCurrentRuntime,
  listRuntimeSessions,
} from "../src/db/runtime-sessions.js";

function tmpDbPath(label: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)), "test.db");
}

describe("runtime_sessions schema", () => {
  let dbPath: string;

  beforeEach(() => {
    resetDb();
    dbPath = tmpDbPath("rt-schema");
    setDbPath(dbPath);
  });

  it("creates the runtime_sessions table on first init", () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_sessions'")
      .all() as { name: string }[];
    assert.equal(tables.length, 1);
  });

  it("adds current_runtime_id and cc_session_id columns to chat_sessions", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    assert.ok(names.includes("current_runtime_id"), "current_runtime_id missing");
    assert.ok(names.includes("cc_session_id"), "cc_session_id missing");
  });

  it("indexes exist for sna_session_id, parent_id, and alive predicate", () => {
    const db = getDb();
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runtime_sessions'",
      )
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    assert.ok(names.includes("idx_runtime_sessions_sna"));
    assert.ok(names.includes("idx_runtime_sessions_parent"));
    assert.ok(names.includes("idx_runtime_sessions_alive"));
  });

  it("is idempotent: re-init does not duplicate the table", () => {
    getDb(); // first init
    resetDb();
    setDbPath(dbPath);
    getDb(); // second init on same file
    const db = new Database(dbPath);
    try {
      const count = db
        .prepare(
          "SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='runtime_sessions'",
        )
        .get() as { c: number };
      assert.equal(count.c, 1);
    } finally {
      db.close();
    }
  });
});

describe("runtime_sessions backfill from chat_sessions.last_start_config", () => {
  let dbPath: string;

  beforeEach(() => {
    resetDb();
    dbPath = tmpDbPath("rt-backfill");
  });

  it("creates one runtime_sessions row per chat_session with a recorded config", () => {
    // Set up a pre-PR database by hand — no runtime_sessions table, no
    // current_runtime_id column, but a populated last_start_config.
    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE chat_sessions (
        id         TEXT PRIMARY KEY,
        label      TEXT NOT NULL DEFAULT '',
        type       TEXT NOT NULL DEFAULT 'main',
        meta       TEXT,
        cwd        TEXT,
        last_start_config TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chat_sessions (id, cwd, last_start_config)
        VALUES (
          'with-config',
          '/Users/test/proj',
          '{"provider":"codex","model":"gpt-5.4","permissionMode":"bypassPermissions"}'
        );
      INSERT INTO chat_sessions (id, cwd, last_start_config)
        VALUES ('no-config', '/tmp/empty', NULL);
    `);
    seed.close();

    // Re-open via the production code path → migration should run.
    setDbPath(dbPath);
    const db = getDb();

    const withConfig = getCurrentRuntime(db, "with-config");
    assert.ok(withConfig, "session with last_start_config should get a runtime");
    const parsed = JSON.parse(withConfig.config) as Record<string, unknown>;
    assert.equal(parsed.provider, "codex");
    assert.equal(parsed.model, "gpt-5.4");
    assert.equal(parsed.cwd, "/Users/test/proj",
      "cwd must be merged into config JSON from the legacy chat_sessions.cwd column");

    const noConfig = getCurrentRuntime(db, "no-config");
    assert.equal(noConfig, null, "session without last_start_config should NOT get a runtime");

    // The migrated session's chat_sessions.current_runtime_id points at it.
    const row = db.prepare(
      "SELECT current_runtime_id FROM chat_sessions WHERE id = ?",
    ).get("with-config") as { current_runtime_id: string | null };
    assert.equal(row.current_runtime_id, withConfig.id);
  });

  it("does not re-migrate already-migrated rows", () => {
    setDbPath(dbPath);
    const db = getDb();
    // Seed a session with a manual runtime_session entry as if it had already
    // been migrated once.
    db.prepare(
      `INSERT INTO chat_sessions (id, cwd, last_start_config, current_runtime_id)
       VALUES (?, ?, ?, ?)`,
    ).run("pre-migrated", "/tmp/x", '{"provider":"codex","model":"gpt-5.4","cwd":"/tmp/x"}', "rt_pre");
    insertRuntimeSession(db, {
      id: "rt_pre",
      snaSessionId: "pre-migrated",
      parentId: null,
      config: { provider: "codex", model: "gpt-5.4", cwd: "/tmp/x" },
    });

    // Reload — migration must observe current_runtime_id is already set and skip.
    resetDb();
    setDbPath(dbPath);
    const db2 = getDb();
    const rts = listRuntimeSessions(db2, "pre-migrated");
    assert.equal(rts.length, 1, "no duplicate row was inserted by the second migration pass");
    assert.equal(rts[0].id, "rt_pre");
  });
});

describe("runtime_sessions DAO", () => {
  let dbPath: string;

  beforeEach(() => {
    resetDb();
    dbPath = tmpDbPath("rt-dao");
    setDbPath(dbPath);
    const db = getDb();
    db.prepare(`INSERT INTO chat_sessions (id) VALUES (?)`).run("s1");
  });

  it("insert + getCurrentRuntime round-trip", () => {
    const db = getDb();
    insertRuntimeSession(db, {
      id: "rt1",
      snaSessionId: "s1",
      parentId: null,
      config: { provider: "codex", model: "gpt-5.4", cwd: "/x" },
    });
    const cur = getCurrentRuntime(db, "s1");
    assert.ok(cur);
    assert.equal(cur.id, "rt1");
    assert.equal(cur.retired_at, null);
    const cfg = JSON.parse(cur.config) as Record<string, unknown>;
    assert.equal(cfg.cwd, "/x");
  });

  it("retired runtimes are not the 'current'", () => {
    const db = getDb();
    const now = Date.now();
    insertRuntimeSession(db, {
      id: "rt1", snaSessionId: "s1", parentId: null,
      config: { provider: "codex", model: "gpt-5.4", cwd: "/old" },
      spawnedAt: now - 1000,
    });
    insertRuntimeSession(db, {
      id: "rt2", snaSessionId: "s1", parentId: "rt1",
      config: { provider: "codex", model: "gpt-5.4", cwd: "/new" },
      spawnedAt: now,
    });
    retireRuntimeSession(db, "rt1", now);

    const cur = getCurrentRuntime(db, "s1");
    assert.equal(cur?.id, "rt2");

    const chain = listRuntimeSessions(db, "s1");
    assert.equal(chain.length, 2);
    assert.equal(chain[0].id, "rt1");
    assert.equal(chain[0].retired_at, now);
    assert.equal(chain[1].id, "rt2");
    assert.equal(chain[1].parent_id, "rt1");
  });

  it("updateRuntimeConfig replaces the JSON in place", () => {
    const db = getDb();
    insertRuntimeSession(db, {
      id: "rt1", snaSessionId: "s1", parentId: null,
      config: { provider: "codex", model: "gpt-5.4", cwd: "/x" },
    });
    updateRuntimeConfig(db, "rt1", {
      provider: "codex", model: "gpt-5.5", cwd: "/x",
    });
    const cur = getCurrentRuntime(db, "s1");
    const cfg = JSON.parse(cur!.config) as Record<string, unknown>;
    assert.equal(cfg.model, "gpt-5.5");
  });

  it("setRuntimeState persists state changes", () => {
    const db = getDb();
    insertRuntimeSession(db, {
      id: "rt1", snaSessionId: "s1", parentId: null,
      config: { provider: "codex", model: "gpt-5.4", cwd: "/x" },
    });
    setRuntimeState(db, "rt1", "processing");
    const cur = getCurrentRuntime(db, "s1");
    assert.equal(cur?.state, "processing");
  });
});
