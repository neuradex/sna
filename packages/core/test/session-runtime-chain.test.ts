/**
 * SessionManager — RuntimeSession chain wiring (#21 phase 5 + 6).
 *
 * Every config mutation (saveStartConfig, restartSession, setSessionModel,
 * setSessionPermissionMode, applySessionPatch) appends a new RuntimeSession
 * node and retires the previous one. The current RT carries the live process
 * pointer; retired RTs are kept for audit.
 *
 * applySessionPatch is the new general-purpose mutator: it consults the
 * provider's applyPatch (in-place fields are applied; leftover triggers a
 * respawn via the caller-supplied callback) and chooses the "in-place" or
 * "respawn" path uniformly so consumers don't have to switch on runtime.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { SessionManager } from "../src/server/session-manager.js";
import type { SessionConfig } from "../src/server/session-manager.js";
import { resetDb } from "../src/db/schema.js";
import { listRuntimeSessions, getCurrentRuntime } from "../src/db/runtime-sessions.js";
import { getDb } from "../src/db/schema.js";
import type { AgentEvent, AgentProcess, ContentBlock, SessionPatch } from "../src/core/providers/types.js";

function tmpDbPath(label: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)), "test.db");
}

function freshSm(label: string): SessionManager {
  resetDb();
  process.env.SNA_DB_PATH = tmpDbPath(label);
  return new SessionManager();
}

const baseConfig = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  provider: "codex",
  model: "gpt-5.4",
  cwd: "/tmp/proj",
  permissionMode: "bypassPermissions",
  ...over,
});

/** Minimal AgentProcess stub. The chain tests don't need real RPC traffic —
 *  they exercise the SessionManager's bookkeeping around applyPatch results. */
class FakeProcess extends EventEmitter implements AgentProcess {
  alive = true;
  pid = null;
  sessionId = null;
  leftover: SessionPatch = {};
  appliedPatches: SessionPatch[] = [];
  modelHistory: string[] = [];
  permissionHistory: string[] = [];
  send(_input: string | ContentBlock[]): void {}
  interrupt(): void {}
  setModel(model: string): void { this.modelHistory.push(model); }
  setPermissionMode(mode: string): void { this.permissionHistory.push(mode); }
  applyPatch(patch: SessionPatch): SessionPatch {
    this.appliedPatches.push(patch);
    // Apply the in-place fields locally to mimic codex / claude semantics.
    if (patch.model !== undefined) this.setModel(patch.model);
    if (patch.permissionMode !== undefined) this.setPermissionMode(patch.permissionMode);
    return this.leftover;
  }
  kill(): void { this.alive = false; }
  closeThread(): void { this.alive = false; }
  on(event: string, handler: (...args: any[]) => void): void { super.on(event, handler); }
  off(event: string, handler: (...args: any[]) => void): void { super.off(event, handler); }
}

describe("SessionManager — RuntimeSession chain on saveStartConfig", () => {
  beforeEach(() => {
    /* fresh DB per test via freshSm */
  });

  it("creates the first RuntimeSession on saveStartConfig", () => {
    const sm = freshSm("chain-first");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig());

    const chain = sm.getRuntimeChain("s1");
    assert.equal(chain.length, 1);
    assert.equal(chain[0].parentId, null);
    assert.equal(chain[0].retiredAt, null);
    assert.equal(chain[0].config.model, "gpt-5.4");

    // Persisted to DB
    const db = getDb();
    const dbChain = listRuntimeSessions(db, "s1");
    assert.equal(dbChain.length, 1);
    assert.equal(dbChain[0].id, chain[0].id);
  });

  it("appends a chain node on each subsequent saveStartConfig", () => {
    const sm = freshSm("chain-multi");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig({ model: "gpt-5.4" }));
    sm.saveStartConfig("s1", baseConfig({ model: "gpt-5.5" }));
    sm.saveStartConfig("s1", baseConfig({ model: "gpt-5.6" }));

    const chain = sm.getRuntimeChain("s1");
    assert.equal(chain.length, 3, "every saveStartConfig appends a node");
    assert.equal(chain[0].config.model, "gpt-5.4");
    assert.equal(chain[1].config.model, "gpt-5.5");
    assert.equal(chain[2].config.model, "gpt-5.6");
    // Only the latest is current
    assert.equal(chain[0].retiredAt !== null, true);
    assert.equal(chain[1].retiredAt !== null, true);
    assert.equal(chain[2].retiredAt, null);
    // Parent pointers form the chain
    assert.equal(chain[1].parentId, chain[0].id);
    assert.equal(chain[2].parentId, chain[1].id);
  });
});

describe("SessionManager — setSessionModel / setSessionPermissionMode chain", () => {
  it("setSessionModel appends a chain node and persists the new model", () => {
    const sm = freshSm("chain-setmodel");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig({ model: "gpt-5.4" }));

    const before = sm.getRuntimeChain("s1").length;
    sm.setSessionModel("s1", "gpt-5.5");
    const after = sm.getRuntimeChain("s1").length;
    assert.equal(after, before + 1, "model swap appends a new RuntimeSession");

    const session = sm.getSession("s1")!;
    assert.equal(session.config?.model, "gpt-5.5");

    // Persisted: current RT row has the new model.
    const db = getDb();
    const cur = getCurrentRuntime(db, "s1");
    const cfg = JSON.parse(cur!.config) as SessionConfig;
    assert.equal(cfg.model, "gpt-5.5");
  });

  it("setSessionPermissionMode appends a chain node", () => {
    const sm = freshSm("chain-setperm");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig({ permissionMode: "bypassPermissions" }));

    const before = sm.getRuntimeChain("s1").length;
    sm.setSessionPermissionMode("s1", "acceptEdits");
    assert.equal(sm.getRuntimeChain("s1").length, before + 1);
    assert.equal(sm.getSession("s1")!.config?.permissionMode, "acceptEdits");
  });
});

describe("SessionManager.applySessionPatch — in-place vs respawn", () => {
  it("in-place: provider applyPatch returns empty leftover → no respawn, process migrates", () => {
    const sm = freshSm("patch-inplace");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig({ model: "gpt-5.4" }));

    const proc = new FakeProcess();
    sm.setProcess("s1", proc);
    proc.leftover = {}; // codex-like: everything in-place

    let respawnCalled = false;
    const result = sm.applySessionPatch("s1", { cwd: "/new", model: "gpt-5.5" }, () => {
      respawnCalled = true;
      return new FakeProcess();
    });

    assert.equal(result.applied, "in-place");
    assert.equal(respawnCalled, false, "respawnFn must not fire when leftover is empty");
    assert.deepEqual(result.fields.sort(), ["cwd", "model"]);

    const session = sm.getSession("s1")!;
    assert.equal(session.process, proc, "process pointer survives in-place transition");
    assert.equal(session.config?.cwd, "/new");
    assert.equal(session.config?.model, "gpt-5.5");

    const chain = sm.getRuntimeChain("s1");
    assert.equal(chain.length, 2);
    assert.equal(chain[1].id, result.runtimeId);
    assert.equal(chain[1].process, proc, "current RT inherits the live process");
  });

  it("respawn: leftover non-empty → caller's respawnFn drives the new process", () => {
    const sm = freshSm("patch-respawn");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig({ provider: "claude-code", model: "haiku" }));

    const proc = new FakeProcess();
    sm.setProcess("s1", proc);
    proc.leftover = { cwd: "/new" }; // claude-like: cwd can't be in-place

    const newProc = new FakeProcess();
    let respawnedWith: SessionConfig | null = null;
    const result = sm.applySessionPatch("s1", { cwd: "/new", model: "claude-opus-4-6" }, (cfg) => {
      respawnedWith = cfg;
      return newProc;
    });

    assert.equal(result.applied, "respawn");
    assert.ok(respawnedWith, "respawnFn was called with merged config");
    assert.equal(respawnedWith!.cwd, "/new");
    assert.equal(respawnedWith!.model, "claude-opus-4-6");

    const session = sm.getSession("s1")!;
    assert.equal(session.process, newProc);
    assert.equal(proc.alive, false, "previous process was killed");

    const chain = sm.getRuntimeChain("s1");
    assert.equal(chain.length, 2);
    assert.equal(chain[1].process, newProc);
  });

  it("empty patch is a no-op (no chain growth)", () => {
    const sm = freshSm("patch-empty");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig());
    sm.setProcess("s1", new FakeProcess());

    const before = sm.getRuntimeChain("s1").length;
    const result = sm.applySessionPatch("s1", {}, () => {
      throw new Error("respawnFn should not be called for an empty patch");
    });
    assert.equal(result.applied, "in-place");
    assert.deepEqual(result.fields, []);
    assert.equal(sm.getRuntimeChain("s1").length, before);
  });

  it("throws when no current runtime exists", () => {
    const sm = freshSm("patch-no-rt");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    assert.throws(
      () => sm.applySessionPatch("s1", { model: "gpt-5.5" }, () => new FakeProcess()),
      /has no active runtime/,
    );
  });
});

describe("SessionInfo.runtimeChain exposure", () => {
  it("listSessions() omits runtimeChain by default", () => {
    const sm = freshSm("info-default");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig());

    const infos = sm.listSessions();
    const info = infos.find((i) => i.id === "s1")!;
    assert.equal(info.runtimeChain, undefined,
      "default listSessions response should not carry the chain — kept small for high-frequency polls");
    assert.ok(info.currentRuntimeId, "currentRuntimeId is part of the default surface");
  });

  it("listSessions({ includeRuntimeChain: true }) embeds the chain", () => {
    const sm = freshSm("info-chain");
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig({ model: "gpt-5.4" }));
    sm.setSessionModel("s1", "gpt-5.5");

    const infos = sm.listSessions({ includeRuntimeChain: true });
    const info = infos.find((i) => i.id === "s1")!;
    assert.ok(Array.isArray(info.runtimeChain));
    assert.equal(info.runtimeChain!.length, 2);
    assert.equal(info.runtimeChain![0].config.model, "gpt-5.4");
    assert.equal(info.runtimeChain![0].retiredAt !== null, true);
    assert.equal(info.runtimeChain![1].config.model, "gpt-5.5");
    assert.equal(info.runtimeChain![1].retiredAt, null);
    assert.equal(info.runtimeChain![1].id, info.currentRuntimeId);
  });

  it("getSessionInfo() returns null for unknown session, info for known", () => {
    const sm = freshSm("info-single");
    assert.equal(sm.getSessionInfo("nope"), null);
    sm.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm.saveStartConfig("s1", baseConfig());
    const info = sm.getSessionInfo("s1", { includeRuntimeChain: true });
    assert.ok(info);
    assert.equal(info!.id, "s1");
    assert.equal(info!.runtimeChain!.length, 1);
  });
});

describe("SessionManager — restoreFromDb rebuilds the chain", () => {
  it("a new SessionManager observes the chain saved by a previous instance", () => {
    const dbPath = tmpDbPath("chain-restore");
    process.env.SNA_DB_PATH = dbPath;

    resetDb();
    const sm1 = new SessionManager();
    sm1.createSession({ id: "s1", cwd: "/tmp/proj" });
    sm1.saveStartConfig("s1", baseConfig({ model: "gpt-5.4" }));
    sm1.setSessionModel("s1", "gpt-5.5");
    sm1.setSessionPermissionMode("s1", "acceptEdits");
    const expectedChain = sm1.getRuntimeChain("s1").length;

    resetDb();
    const sm2 = new SessionManager();
    const restored = sm2.getRuntimeChain("s1");
    assert.equal(restored.length, expectedChain);
    const cur = sm2.getCurrentRuntime("s1");
    assert.equal(cur?.config.model, "gpt-5.5");
    assert.equal(cur?.config.permissionMode, "acceptEdits");
    assert.equal(sm2.getSession("s1")!.config?.model, "gpt-5.5");
  });
});
