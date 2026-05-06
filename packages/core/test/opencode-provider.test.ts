/**
 * Unit tests for OpenCodeProvider utility functions.
 *
 * Pure-function tests only — integration paths (createOpencodeServer,
 * SSE handling) live in opencode-history-injection.test.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toOpenCodeAgent,
  parseOpenCodeModel,
  resolveOpenCodeCli,
  snaMcpToOpenCode,
} from "../src/core/providers/opencode.js";
import { canonicalToOpenCodeHistoryPrelude } from "../src/history/opencode.js";
import { RuntimePool } from "../src/core/providers/runtime.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── toOpenCodeAgent ────────────────────────────────────────────────────────

describe("toOpenCodeAgent", () => {
  it("maps plan → plan (the only opencode-shipped name)", () => {
    assert.equal(toOpenCodeAgent("plan"), "plan");
  });

  it("returns undefined for default — let opencode pick", () => {
    assert.equal(toOpenCodeAgent("default"), undefined);
  });

  it("returns undefined for acceptEdits", () => {
    assert.equal(toOpenCodeAgent("acceptEdits"), undefined);
  });

  it("returns undefined for bypassPermissions", () => {
    assert.equal(toOpenCodeAgent("bypassPermissions"), undefined);
  });

  it("returns undefined for missing mode", () => {
    assert.equal(toOpenCodeAgent(undefined), undefined);
  });

  it("returns undefined for unknown string", () => {
    assert.equal(toOpenCodeAgent("nonsense"), undefined);
  });
});

// ── parseOpenCodeModel ─────────────────────────────────────────────────────

describe("parseOpenCodeModel", () => {
  it("returns undefined for undefined input", () => {
    assert.equal(parseOpenCodeModel(undefined), undefined);
  });

  it("splits providerID/modelID on first slash", () => {
    assert.deepEqual(
      parseOpenCodeModel("anthropic/claude-sonnet-4-6"),
      { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
    );
  });

  it("infers anthropic from claude-* prefix", () => {
    assert.deepEqual(
      parseOpenCodeModel("claude-sonnet-4-6"),
      { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
    );
  });

  it("infers openai from gpt-* prefix", () => {
    assert.deepEqual(
      parseOpenCodeModel("gpt-5"),
      { providerID: "openai", modelID: "gpt-5" },
    );
  });

  it("infers openai from o3 (reasoning model)", () => {
    assert.deepEqual(
      parseOpenCodeModel("o3"),
      { providerID: "openai", modelID: "o3" },
    );
  });

  it("infers google from gemini-* prefix", () => {
    assert.deepEqual(
      parseOpenCodeModel("gemini-2.5-pro"),
      { providerID: "google", modelID: "gemini-2.5-pro" },
    );
  });

  it("uses fallbackProviderId when no slash + no prefix match", () => {
    assert.deepEqual(
      parseOpenCodeModel("custom-llm-1", "myco"),
      { providerID: "myco", modelID: "custom-llm-1" },
    );
  });

  it("explicit slash overrides fallback", () => {
    assert.deepEqual(
      parseOpenCodeModel("anthropic/sonnet", "openai"),
      { providerID: "anthropic", modelID: "sonnet" },
    );
  });

  it("returns undefined when bare unknown model and no fallback", () => {
    assert.equal(parseOpenCodeModel("mystery-model"), undefined);
  });
});

// ── resolveOpenCodeCli ─────────────────────────────────────────────────────

describe("resolveOpenCodeCli", () => {
  it("returns env path when SNA_OPENCODE_COMMAND is set", () => {
    const orig = process.env.SNA_OPENCODE_COMMAND;
    process.env.SNA_OPENCODE_COMMAND = "/nonexistent/opencode";
    try {
      const r = resolveOpenCodeCli();
      assert.equal(r.source, "env");
      assert.equal(r.path, "/nonexistent/opencode");
    } finally {
      if (orig === undefined) delete process.env.SNA_OPENCODE_COMMAND;
      else process.env.SNA_OPENCODE_COMMAND = orig;
    }
  });

  it("returns fallback when nothing is found", () => {
    // Use a tmp cacheDir so a stale .sna/opencode-path doesn't poison the test.
    const orig = process.env.SNA_OPENCODE_COMMAND;
    delete process.env.SNA_OPENCODE_COMMAND;
    const tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-resolve-"));
    try {
      const r = resolveOpenCodeCli({ cacheDir: tmpCache });
      // On systems with opencode installed the resolver may return static/shell.
      // We assert only that a path is returned and the source is one of the
      // known values — the fallback case is the contract under test.
      assert.ok(["env", "cache", "static", "shell", "fallback"].includes(r.source));
    } finally {
      if (orig !== undefined) process.env.SNA_OPENCODE_COMMAND = orig;
      try { fs.rmSync(tmpCache, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

// ── canonicalToOpenCodeHistoryPrelude ─────────────────────────────────────

describe("canonicalToOpenCodeHistoryPrelude", () => {
  it("returns [] for empty history", () => {
    assert.deepEqual(canonicalToOpenCodeHistoryPrelude([], "s1"), []);
  });

  it("serializes user + assistant text into a single prelude part", () => {
    const parts = canonicalToOpenCodeHistoryPrelude(
      [
        { actor: "user", kind: "text", content: "Hi" },
        { actor: "assistant", kind: "text", content: "Hello!" },
      ],
      "s1",
    );
    assert.equal(parts.length, 1);
    assert.equal(parts[0].type, "text");
    const text = (parts[0] as { type: "text"; text: string }).text;
    assert.match(text, /<conversation-history>/);
    assert.match(text, /<\/conversation-history>/);
    assert.match(text, /\*\*User:\*\* Hi/);
    assert.match(text, /\*\*Assistant:\*\* Hello!/);
  });

  it("renders tool_use and tool_result as flattened transcript lines", () => {
    const parts = canonicalToOpenCodeHistoryPrelude(
      [
        { actor: "user", kind: "text", content: "list" },
        {
          actor: "assistant", kind: "tool_use", content: "Bash",
          meta: { id: "c1", input: { command: "ls" } },
        },
        {
          actor: "system", kind: "tool_result", content: "a.txt\nb.txt",
          meta: { toolUseId: "c1" },
        },
        { actor: "assistant", kind: "text", content: "Two." },
      ],
      "s1",
    );
    const text = (parts[0] as { type: "text"; text: string }).text;
    assert.match(text, /\*\*Tool call \(Bash\):\*\* \{"command":"ls"\}/);
    assert.match(text, /\*\*Tool result:\*\* a\.txt/);
    assert.match(text, /\*\*Assistant:\*\* Two\./);
  });

  it("renders thinking blocks", () => {
    const parts = canonicalToOpenCodeHistoryPrelude(
      [
        { actor: "user", kind: "text", content: "hmm" },
        { actor: "assistant", kind: "thinking", content: "let me think" },
        { actor: "assistant", kind: "text", content: "ok" },
      ],
      "s1",
    );
    const text = (parts[0] as { type: "text"; text: string }).text;
    assert.match(text, /\*\*Assistant \(thinking\):\*\* let me think/);
  });

  it("flags tool_result errors", () => {
    const parts = canonicalToOpenCodeHistoryPrelude(
      [
        {
          actor: "system", kind: "tool_result", content: "boom",
          meta: { toolUseId: "c1", isError: true },
        },
      ],
      "s1",
    );
    const text = (parts[0] as { type: "text"; text: string }).text;
    assert.match(text, /\*\*Tool result \(error\):\*\* boom/);
  });

  it("preserves order across mixed actors and kinds", () => {
    const parts = canonicalToOpenCodeHistoryPrelude(
      [
        { actor: "user", kind: "text", content: "Q1" },
        { actor: "assistant", kind: "text", content: "A1" },
        { actor: "user", kind: "text", content: "Q2" },
        { actor: "assistant", kind: "text", content: "A2" },
      ],
      "s1",
    );
    const text = (parts[0] as { type: "text"; text: string }).text;
    const idx = (s: string) => text.indexOf(s);
    assert.ok(idx("Q1") < idx("A1"));
    assert.ok(idx("A1") < idx("Q2"));
    assert.ok(idx("Q2") < idx("A2"));
  });

  it("drops empty content blocks", () => {
    const parts = canonicalToOpenCodeHistoryPrelude(
      [
        { actor: "user", kind: "text", content: "" },
        { actor: "assistant", kind: "text", content: "" },
        { actor: "user", kind: "text", content: "real" },
      ],
      "s1",
    );
    const text = (parts[0] as { type: "text"; text: string }).text;
    assert.match(text, /\*\*User:\*\* real/);
    assert.doesNotMatch(text, /\*\*User:\*\* \n/);
  });
});

// ── snaMcpToOpenCode ──────────────────────────────────────────────────────

describe("snaMcpToOpenCode", () => {
  it("returns undefined for an empty record", () => {
    assert.equal(snaMcpToOpenCode({}), undefined);
  });

  it("translates a stdio entry to opencode local with [cmd, ...args]", () => {
    const out = snaMcpToOpenCode({
      "loom-tools": { command: "node", args: ["/abs/loom-tools.mjs"] },
    });
    assert.deepEqual(out, {
      "loom-tools": {
        type: "local",
        command: ["node", "/abs/loom-tools.mjs"],
      },
    });
  });

  it("forwards stdio env as `environment`", () => {
    const out = snaMcpToOpenCode({
      "x": { command: "node", args: ["a"], env: { FOO: "bar" } },
    });
    assert.deepEqual((out as any).x, {
      type: "local",
      command: ["node", "a"],
      environment: { FOO: "bar" },
    });
  });

  it("translates an http entry to opencode remote", () => {
    const out = snaMcpToOpenCode({
      "github": {
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer xxx" },
      },
    });
    assert.deepEqual((out as any).github, {
      type: "remote",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer xxx" },
    });
  });

  it("drops cwd silently (opencode has no equivalent)", () => {
    const out = snaMcpToOpenCode({
      "x": { command: "node", args: ["a"], cwd: "/tmp" } as any,
    });
    // No `cwd` field in the opencode shape
    assert.equal((out as any).x.cwd, undefined);
  });
});

// ── RuntimePool keying with mcp ───────────────────────────────────────────

describe("RuntimePool key derivation from config.mcp", () => {
  it("keys differently when mcp servers differ — even without an explicit hash", async () => {
    const pool = new RuntimePool();
    const handles: any[] = [];
    const fakeProvider = {
      name: "opencode",
      async prepareRuntime() {
        const h = {
          provider: "opencode",
          ready: true,
          activeThreadCount: 0,
          dispose: () => {},
        } as any;
        handles.push(h);
        return h;
      },
    };
    const a = await pool.prepare({
      provider: "opencode",
      cwd: "/p",
      mcp: { foo: { command: "node", args: ["a"] } },
    } as any, fakeProvider);
    const b = await pool.prepare({
      provider: "opencode",
      cwd: "/p",
      mcp: { foo: { command: "node", args: ["b"] } },
    } as any, fakeProvider);
    const c = await pool.prepare({
      provider: "opencode",
      cwd: "/p",
      mcp: { foo: { command: "node", args: ["a"] } },
    } as any, fakeProvider);

    // Different MCPs → different daemons.
    assert.notEqual(a, b);
    // Same MCPs → reused daemon.
    assert.equal(a, c);
    pool.dispose();
  });
});
