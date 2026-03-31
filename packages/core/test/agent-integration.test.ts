/**
 * Agent integration tests — real Claude Code binary + mock Anthropic API.
 *
 * Spawns claude directly (like sna tu claude) with clean env.
 * Verifies the full Claude Code ↔ mock API pipeline.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { startMockAnthropicServer, type MockServer } from "../src/testing/mock-api.js";

let CLAUDE_PATH: string | null = null;
try { CLAUDE_PATH = execSync("which claude", { encoding: "utf8" }).trim(); } catch {}

const TEST_DIR = path.join(import.meta.dirname, "../.test-data-agent");

function cleanEnv(mockPort: number): Record<string, string> {
  const configDir = path.join(TEST_DIR, ".mock-config");
  fs.mkdirSync(configDir, { recursive: true });
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TERM: process.env.TERM ?? "xterm-256color",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    ANTHROPIC_BASE_URL: `http://localhost:${mockPort}`,
    ANTHROPIC_API_KEY: "sk-test-mock",
    CLAUDE_CONFIG_DIR: configDir,
  };
}

/** Spawn claude with stream-json, return parsed events */
function runClaude(mockPort: number, prompt: string, extraArgs: string[] = []): Promise<{ events: any[]; code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_PATH!, [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode", "bypassPermissions",
      "--model", "test-mock",
      ...extraArgs,
      prompt,
    ], {
      env: cleanEnv(mockPort),
      cwd: TEST_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr!.on("data", () => {});

    proc.on("exit", (code) => {
      const events = stdout.trim().split("\n").map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      resolve({ events, code });
    });

    // Safety timeout
    setTimeout(() => { proc.kill(); }, 30000);
  });
}

describe("Agent Integration (real CC + mock API)", { skip: !CLAUDE_PATH ? "claude not installed" : undefined }, () => {
  let mock: MockServer;

  before(async () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    mock = await startMockAnthropicServer();
  });

  after(() => {
    mock?.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("init event contains session_id and model", async () => {
    const { events, code } = await runClaude(mock.port, "hello");
    assert.equal(code, 0, "claude should exit 0");

    const init = events.find(e => e.type === "system" && e.subtype === "init");
    assert.ok(init, "should have init event");
    assert.ok(init.session_id, "init should have session_id");
    assert.equal(init.model, "test-mock");
    assert.equal(init.apiKeySource, "ANTHROPIC_API_KEY");
  });

  it("assistant response contains reversed user text", async () => {
    const { events } = await runClaude(mock.port, "hello world");

    const asst = events.find(e => e.type === "assistant");
    assert.ok(asst, "should have assistant event");
    const text = asst.message?.content?.find((b: any) => b.type === "text")?.text;
    assert.ok(text?.includes("dlrow olleh"), `response should be reversed, got: ${text}`);
  });

  it("result event has success subtype and cost", async () => {
    const { events } = await runClaude(mock.port, "test");

    const result = events.find(e => e.type === "result");
    assert.ok(result, "should have result event");
    assert.equal(result.subtype, "success");
    assert.equal(result.is_error, false);
    assert.ok(result.total_cost_usd !== undefined);
  });

  it("mock server receives the request", async () => {
    const before = mock.requests.length;
    await runClaude(mock.port, "request test");

    assert.ok(mock.requests.length > before, "mock should receive request");
    const lastReq = mock.requests[mock.requests.length - 1];
    assert.equal(lastReq.model, "test-mock");
    assert.equal(lastReq.stream, true);
  });

  it("Korean text is handled correctly", async () => {
    const { events } = await runClaude(mock.port, "안녕하세요");

    const asst = events.find(e => e.type === "assistant");
    const text = asst?.message?.content?.find((b: any) => b.type === "text")?.text;
    assert.ok(text?.includes("요세하녕안"), `Korean should be reversed, got: ${text}`);
  });

  it("exit code is 0 on success", async () => {
    const { code } = await runClaude(mock.port, "exit test");
    assert.equal(code, 0);
  });

  it("bypassPermissions mode has no permission denials", async () => {
    const { events } = await runClaude(mock.port, "permission check");

    const result = events.find(e => e.type === "result");
    assert.ok(result);
    assert.deepEqual(result.permission_denials, []);
  });

  it("multiple requests accumulate in mock server", async () => {
    const before = mock.requests.length;
    await runClaude(mock.port, "first");
    await runClaude(mock.port, "second");
    await runClaude(mock.port, "third");

    assert.ok(mock.requests.length >= before + 3);
  });
});
