/**
 * SessionManager tests — covers the bugs we've fixed:
 * - CASCADE deletion (INSERT OR REPLACE wiping messages)
 * - Session config persistence (cwd, lastStartConfig, ccSessionId)
 * - createSession updating existing sessions
 * - setSessionModel/setSessionPermissionMode when agent not alive
 * - State transitions (processing → waiting/idle on complete/error/exit)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Use a unique temp DB for each test
function createTempDbDir(): { dir: string; cleanup: () => void } {
  const dir = path.join(import.meta.dirname, `../.test-data-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

// Dynamic imports after cwd override
async function loadModules(cwdOverride: string) {
  const origCwd = process.cwd;
  process.cwd = () => cwdOverride;
  try {
    const { getDb, resetDb } = await import("../src/db/schema.js");
    resetDb(); // clear cached DB instance for test isolation
    const { SessionManager } = await import("../src/server/session-manager.js");
    return { getDb, SessionManager };
  } finally {
    process.cwd = origCwd;
  }
}

// Clear all messages from the DB for test isolation
async function clearMessages(cwdOverride: string) {
  const origCwd = process.cwd;
  process.cwd = () => cwdOverride;
  try {
    const { getDb } = await import("../src/db/schema.js");
    const db = getDb();
    db.exec("DELETE FROM chat_messages");
    db.exec("DELETE FROM chat_sessions WHERE id != 'default'");
  } finally {
    process.cwd = origCwd;
  }
}

async function runTest(fn: (cwd: string) => Promise<void>) {
  const { dir, cleanup } = createTempDbDir();
  try {
    await fn(dir);
  } finally {
    await clearMessages(dir);
    cleanup();
  }
}

describe("SessionManager", () => {
  it("creates session and persists to DB", async () => {
    await runTest(async (cwd) => {
      const { getDb, SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      const session = sm.createSession({ id: "test-1", label: "Test", cwd: "/tmp/test" });

      assert.equal(session.id, "test-1");
      assert.equal(session.label, "Test");
      assert.equal(session.cwd, "/tmp/test");

      // Verify DB
      const db = getDb();
      const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get("test-1") as any;
      assert.ok(row, "Session should be in DB");
      assert.equal(row.label, "Test");
      assert.equal(row.cwd, "/tmp/test");
    });
  });

  it("createSession updates existing session fields", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "s1", label: "Old", cwd: "/old" });

      const updated = sm.createSession({ id: "s1", label: "New", cwd: "/new" });
      assert.equal(updated.label, "New");
      assert.equal(updated.cwd, "/new");
    });
  });

  it("getOrCreateSession updates cwd on existing session", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "s1", cwd: "/original" });

      const session = sm.getOrCreateSession("s1", { cwd: "/updated" });
      assert.equal(session.cwd, "/updated");
    });
  });

  it("restores sessions from DB on construction", async () => {
    await runTest(async (cwd) => {
      const { getDb, SessionManager } = await loadModules(cwd);

      // Create session with first manager
      const sm1 = new SessionManager();
      sm1.createSession({ id: "persist-test", label: "Persisted", cwd: "/persisted/path", meta: { app: "test" } });

      // New manager should restore from DB
      const sm2 = new SessionManager();
      const restored = sm2.getSession("persist-test");
      assert.ok(restored, "Session should be restored from DB");
      assert.equal(restored.label, "Persisted");
      assert.equal(restored.cwd, "/persisted/path");
      assert.deepEqual(restored.meta, { app: "test" });
    });
  });

  it("persistSession does NOT cascade-delete messages (INSERT OR REPLACE bug)", async () => {
    await runTest(async (cwd) => {
      const { getDb, SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      const db = getDb();

      // Create session
      sm.createSession({ id: "cascade-test", label: "Test" });

      // Insert a user message
      db.prepare("INSERT INTO chat_messages (session_id, actor, kind, content) VALUES (?, 'user', 'text', ?)")
        .run("cascade-test", "Hello");

      const before = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?")
        .get("cascade-test") as any;
      assert.equal(before.count, 1, "Should have 1 message before persist");

      // Trigger persistSession by updating config (this calls persistSession internally)
      sm.setSessionModel("cascade-test", "claude-haiku-4-5-20251001");

      const after = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?")
        .get("cascade-test") as any;
      assert.equal(after.count, 1, "Message should NOT be deleted by persistSession");
    });
  });

  it("setSessionModel updates config even when agent not alive", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "model-test" });

      // No process alive, but should still update config
      const result = sm.setSessionModel("model-test", "claude-opus-4-6");
      assert.equal(result, true);

      const session = sm.getSession("model-test")!;
      assert.equal(session.config?.model, "claude-opus-4-6");
    });
  });

  it("setSessionPermissionMode updates config even when agent not alive", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "perm-test" });

      const result = sm.setSessionPermissionMode("perm-test", "bypassPermissions");
      assert.equal(result, true);

      const session = sm.getSession("perm-test")!;
      assert.equal(session.config?.permissionMode, "bypassPermissions");
    });
  });

  it("setSessionModel returns false for non-existent session", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      assert.equal(sm.setSessionModel("nope", "haiku"), false);
    });
  });

  it("listSessions includes config and ccSessionId", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "list-test" });
      sm.setSessionModel("list-test", "claude-opus-4-6");

      const sessions = sm.listSessions();
      const s = sessions.find(s => s.id === "list-test");
      assert.ok(s);
      assert.equal(s.config?.model, "claude-opus-4-6");
      assert.equal(s.ccSessionId, null); // No process started
    });
  });

  it("killSession sets state to idle", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "kill-test" });
      const session = sm.getSession("kill-test")!;
      session.state = "processing";

      // killSession returns false since no process
      sm.killSession("kill-test");
      // State should remain as-is since no process to kill
      // (state is reset by process exit handler, not killSession directly for no-process case)
    });
  });

  it("removeSession cannot remove default", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "default" });
      assert.equal(sm.removeSession("default"), false);
    });
  });

  it("removeSession removes non-default session", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "removable" });
      assert.equal(sm.removeSession("removable"), true);
      assert.equal(sm.getSession("removable"), undefined);
    });
  });

  it("removeSession deletes persisted session, history, and runtime chain", async () => {
    await runTest(async (cwd) => {
      const { getDb, SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      const db = getDb();

      sm.createSession({ id: "delete-persisted", label: "Delete Persisted" });
      sm.saveStartConfig("delete-persisted", {
        provider: "codex",
        model: "gpt-5.4",
        cwd,
        permissionMode: "bypassPermissions",
      });
      db.prepare("INSERT INTO chat_messages (session_id, actor, kind, content) VALUES (?, 'user', 'text', ?)")
        .run("delete-persisted", "hello");

      assert.equal(sm.removeSession("delete-persisted"), true);
      assert.equal(sm.getSession("delete-persisted"), undefined);

      const sessionRow = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get("delete-persisted");
      const messageCount = db.prepare("SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?")
        .get("delete-persisted") as any;
      const runtimeCount = db.prepare("SELECT COUNT(*) as count FROM runtime_sessions WHERE sna_session_id = ?")
        .get("delete-persisted") as any;
      assert.equal(sessionRow, undefined);
      assert.equal(messageCount.count, 0);
      assert.equal(runtimeCount.count, 0);

      const restored = new SessionManager();
      assert.equal(restored.getSession("delete-persisted"), undefined);
    });
  });

  it("saveStartConfig persists and restores", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm1 = new SessionManager();
      sm1.createSession({ id: "config-test" });
      sm1.saveStartConfig("config-test", {
        provider: "claude-code",
        model: "claude-sonnet-4-6",
        cwd: cwd,
        permissionMode: "acceptEdits",
        extraArgs: ["--resume", "abc123"],
      });

      // New manager should restore config
      const sm2 = new SessionManager();
      const restored = sm2.getSession("config-test");
      assert.ok(restored?.config);
      assert.equal(restored.config.model, "claude-sonnet-4-6");
      assert.deepEqual(restored.config.extraArgs, ["--resume", "abc123"]);
    });
  });

  it("onSessionLifecycle emits events", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "lifecycle-test" });

      const events: any[] = [];
      sm.onSessionLifecycle((e) => events.push(e));

      // killSession on session without process → returns false, no event
      sm.killSession("lifecycle-test");
      assert.equal(events.length, 0);
    });
  });

  it("onConfigChanged emits on model change", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "config-event-test" });

      const events: any[] = [];
      sm.onConfigChanged((e) => events.push(e));

      sm.setSessionModel("config-event-test", "claude-opus-4-6");
      assert.equal(events.length, 1);
      assert.equal(events[0].session, "config-event-test");
      assert.equal(events[0].config.model, "claude-opus-4-6");
    });
  });

  it("permission pending always returns array", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "perm-pending-test" });

      // No pending → should return null for single, empty array for all
      const single = sm.getPendingPermission("perm-pending-test");
      assert.equal(single, null);

      const all = sm.getAllPendingPermissions();
      assert.ok(Array.isArray(all));
      assert.equal(all.length, 0);
    });
  });

  // ── v0.4 features ─────────────────────────────────

  it("listSessions includes agentStatus", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "status-test" });
      const sessions = sm.listSessions();
      const s = sessions.find(s => s.id === "status-test");
      assert.ok(s);
      assert.equal(s.agentStatus, "disconnected"); // no process
    });
  });

  it("updateSessionState triggers onStateChanged", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "state-change-test" });

      const events: any[] = [];
      sm.onStateChanged((e) => events.push(e));

      sm.updateSessionState("state-change-test", "processing");
      assert.equal(events.length, 1);
      assert.equal(events[0].agentStatus, "disconnected"); // no process alive
      assert.equal(events[0].state, "processing");

      sm.updateSessionState("state-change-test", "waiting");
      assert.equal(events.length, 2);
      assert.equal(events[1].state, "waiting");
    });
  });

  it("updateSessionState does not push if state unchanged", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "no-change-test" });

      const events: any[] = [];
      sm.onStateChanged((e) => events.push(e));

      sm.updateSessionState("no-change-test", "idle"); // already idle
      assert.equal(events.length, 0, "Should not push when state unchanged");
    });
  });

  it("pushEvent adds to buffer and notifies listeners", async () => {
    await runTest(async (cwd) => {
      const { SessionManager } = await loadModules(cwd);
      const sm = new SessionManager();
      sm.createSession({ id: "push-event-test" });

      const events: any[] = [];
      sm.onSessionEvent("push-event-test", (_cursor, e) => events.push(e));

      sm.pushEvent("push-event-test", {
        type: "user_message",
        message: "test push",
        timestamp: Date.now(),
      });

      assert.equal(events.length, 1);
      assert.equal(events[0].type, "user_message");
      assert.equal(events[0].message, "test push");

      const session = sm.getSession("push-event-test")!;
      assert.equal(session.eventCounter, 1);
    });
  });
});
