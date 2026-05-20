/**
 * Codex per-thread / per-turn cwd forwarding.
 *
 * codex app-server's `ThreadStartParams.cwd`, `ThreadResumeParams.cwd`, and
 * `TurnStartParams.cwd` let each thread carry its own working directory, so
 * one shared daemon can host sessions operating on different cwds. The
 * provider has to actually pass `options.cwd` through to those RPC params —
 * this file verifies it does, and that the RuntimePool drops cwd from its
 * key so cross-cwd sessions share one daemon.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexProvider } from "../src/core/providers/codex.js";
import { RuntimePool } from "../src/core/providers/runtime.js";
import type { CanonicalBlock } from "../src/history/types.js";
import { startMockCodexAppServer, type MockCodexServer } from "./mock-codex-app-server.js";

/** Create a fresh temp dir for use as a test cwd. */
function tmpCwd(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `codex-cwd-${label}-`));
  return dir;
}

async function waitFor(fn: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("CodexProvider per-thread cwd", () => {
  let mock: MockCodexServer;
  const origCodexCmd = process.env.SNA_CODEX_COMMAND;

  before(() => {
    mock = startMockCodexAppServer();
    process.env.SNA_CODEX_COMMAND = mock.command;
  });

  after(() => {
    if (origCodexCmd === undefined) delete process.env.SNA_CODEX_COMMAND;
    else process.env.SNA_CODEX_COMMAND = origCodexCmd;
    mock.close();
  });

  beforeEach(() => mock.reset());

  it("declares supportsCwdPerThread = true", () => {
    const provider = new CodexProvider();
    assert.equal(provider.supportsCwdPerThread, true);
  });

  it("forwards options.cwd into thread/start params", async () => {
    const cwd = tmpCwd("projA");
    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd });
    await waitFor(() => mock.requestsFor("thread/start").length > 0);
    proc.kill();

    const starts = mock.requestsFor("thread/start");
    assert.equal(starts.length, 1, "exactly one thread/start should fire");
    assert.equal((starts[0].params as { cwd?: string }).cwd, cwd);
  });

  it("forwards options.cwd into thread/resume params when history is injected", async () => {
    const cwd = tmpCwd("projB");
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "hi" },
      { actor: "assistant", kind: "text", content: "hello" },
    ];
    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd, history });
    await waitFor(() => mock.requestsFor("thread/resume").length > 0);
    proc.kill();

    const resumes = mock.requestsFor("thread/resume");
    assert.equal(resumes.length, 1);
    assert.equal((resumes[0].params as { cwd?: string }).cwd, cwd);
  });

  it("forwards options.cwd into thread/resume params when resuming a known threadId", async () => {
    const cwd = tmpCwd("projC");
    const provider = new CodexProvider();
    const proc = provider.spawn({
      cwd,
      extraArgs: ["--resume", "thread-xyz"],
    });
    await waitFor(() => mock.requestsFor("thread/resume").length > 0);
    proc.kill();

    const resumes = mock.requestsFor("thread/resume");
    assert.equal(resumes.length, 1);
    assert.equal((resumes[0].params as { cwd?: string }).cwd, cwd);
  });

  it("omits cwd from thread/start when options.cwd is not set", async () => {
    const provider = new CodexProvider();
    // CodexProvider falls back to process.cwd() for the daemon spawn, but the
    // thread/start params must reflect only what the caller supplied — this
    // keeps "no cwd intent" distinguishable from "cwd happens to equal pcwd".
    const proc = provider.spawn({ cwd: "" });
    await waitFor(() => mock.requestsFor("thread/start").length > 0);
    proc.kill();

    const starts = mock.requestsFor("thread/start");
    assert.equal(starts.length, 1);
    const params = starts[0].params as { cwd?: string };
    assert.equal(params.cwd, undefined, "cwd should be absent, not empty-string");
  });
});

// ── RuntimePool key dedup ────────────────────────────────────────────────────

describe("RuntimePool with supportsCwdPerThread", () => {
  it("dedupes codex daemons across cwds", async () => {
    const pool = new RuntimePool();
    const provider = {
      name: "codex",
      supportsCwdPerThread: true,
      prepareRuntime: async () => ({
        provider: "codex",
        ready: true,
        activeThreadCount: 0,
        dispose: () => {},
        // a sentinel so we can verify reuse
        daemon: { pid: 12345 } as unknown as undefined,
      }),
    };

    const handleA = await pool.prepare({ cwd: "/Users/test/projA" }, provider);
    const handleB = await pool.prepare({ cwd: "/Users/test/projB" }, provider);

    assert.strictEqual(handleA, handleB, "different cwds must share one pooled daemon");
    assert.equal(pool.size, 1);
  });

  it("still splits codex daemons by configDir / mcp / settings", async () => {
    const pool = new RuntimePool();
    let prepareCount = 0;
    const provider = {
      name: "codex",
      supportsCwdPerThread: true,
      prepareRuntime: async () => ({
        provider: "codex",
        ready: true,
        activeThreadCount: 0,
        dispose: () => {},
        daemon: { pid: ++prepareCount } as unknown as undefined,
      }),
    };

    const a = await pool.prepare({ cwd: "/x", configDir: "/home/a" }, provider);
    const b = await pool.prepare({ cwd: "/x", configDir: "/home/b" }, provider);

    assert.notStrictEqual(a, b, "different configDir still gets a separate daemon");
    assert.equal(pool.size, 2);
  });

  it("splits codex daemons by providerOptions.config without requiring a manual configHash", async () => {
    const pool = new RuntimePool();
    let prepareCount = 0;
    const provider = {
      name: "codex",
      supportsCwdPerThread: true,
      prepareRuntime: async () => ({
        provider: "codex",
        ready: true,
        activeThreadCount: 0,
        dispose: () => {},
        daemon: { pid: ++prepareCount } as unknown as undefined,
      }),
    };

    const a = await pool.prepare({
      cwd: "/x",
      providerOptions: { config: { model_provider: "openai" } },
    }, provider);
    const b = await pool.prepare({
      cwd: "/x",
      providerOptions: { config: { model_provider: "anthropic" } },
    }, provider);
    const c = await pool.prepare({
      cwd: "/y",
      providerOptions: { config: { model_provider: "openai" } },
    }, provider);

    assert.notStrictEqual(a, b, "different Codex -c overrides need separate daemons");
    assert.strictEqual(a, c, "same Codex -c overrides still share across cwd");
    assert.equal(pool.size, 2);
  });

  it("does not affect providers without the flag", async () => {
    const pool = new RuntimePool();
    let prepareCount = 0;
    const provider = {
      name: "legacy",
      // No supportsCwdPerThread — defaults to undefined → false.
      prepareRuntime: async () => ({
        provider: "legacy",
        ready: true,
        activeThreadCount: 0,
        dispose: () => {},
        daemon: { pid: ++prepareCount } as unknown as undefined,
      }),
    };

    const a = await pool.prepare({ cwd: "/x" }, provider);
    const b = await pool.prepare({ cwd: "/y" }, provider);

    assert.notStrictEqual(a, b, "without the flag, cwd still discriminates");
    assert.equal(pool.size, 2);
  });
});
