/**
 * Agent integration tests — real Claude Code via `sna tu claude` + mock Anthropic API.
 *
 * All claude invocations go through `sna tu claude` which provides:
 * - Isolated CLAUDE_CONFIG_DIR (no user account pollution)
 * - Clean env (no OAuth token leakage)
 * - ANTHROPIC_BASE_URL → mock server
 * - ANTHROPIC_API_KEY → fake key
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { startMockAnthropicServer, type MockServer } from "../src/testing/mock-api.js";

let CLAUDE_AVAILABLE = false;
try { execSync("which claude", { stdio: "pipe" }); CLAUDE_AVAILABLE = true; } catch {}

const TEST_DIR = path.join(import.meta.dirname, "../.test-data-agent");
const SNA_SCRIPT = path.join(import.meta.dirname, "../src/scripts/sna.ts");

/** Run claude via `sna tu claude`, return parsed stream-json events */
function runClaude(prompt: string, extraArgs: string[] = []): Promise<{ events: any[]; code: number | null }> {
  const args = [
    "--import", "tsx", SNA_SCRIPT, "tu", "claude",
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--model", "test-mock",
    ...extraArgs,
    prompt,
  ];

  return new Promise((resolve) => {
    const proc = spawn("node", args, {
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

    setTimeout(() => { proc.kill(); }, 30000);
  });
}

describe("Agent Integration (sna tu claude + mock API)", { skip: !CLAUDE_AVAILABLE ? "claude not installed" : undefined }, () => {
  let mock: MockServer;

  before(async () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(path.join(TEST_DIR, ".sna"), { recursive: true });

    // Start mock API and write port file (sna tu claude reads it)
    mock = await startMockAnthropicServer();
    fs.writeFileSync(path.join(TEST_DIR, ".sna/mock-api.port"), String(mock.port));
  });

  after(() => {
    mock?.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("init event contains session_id and model", async () => {
    const { events, code } = await runClaude("hello");
    assert.equal(code, 0);

    const init = events.find(e => e.type === "system" && e.subtype === "init");
    assert.ok(init, "should have init event");
    assert.ok(init.session_id);
    assert.equal(init.model, "test-mock");
    assert.equal(init.apiKeySource, "ANTHROPIC_API_KEY");
  });

  it("assistant response contains reversed user text", async () => {
    const { events } = await runClaude("hello world");

    const asst = events.find(e => e.type === "assistant");
    assert.ok(asst);
    const text = asst.message?.content?.find((b: any) => b.type === "text")?.text;
    assert.ok(text?.includes("dlrow olleh"), `should be reversed, got: ${text}`);
  });

  it("result event has success subtype and cost", async () => {
    const { events } = await runClaude("test");

    const result = events.find(e => e.type === "result");
    assert.ok(result);
    assert.equal(result.subtype, "success");
    assert.equal(result.is_error, false);
    assert.ok(result.total_cost_usd !== undefined);
  });

  it("mock server receives the request", async () => {
    const before = mock.requests.length;
    await runClaude("request test");

    assert.ok(mock.requests.length > before);
    const lastReq = mock.requests[mock.requests.length - 1];
    assert.equal(lastReq.model, "test-mock");
    assert.equal(lastReq.stream, true);
  });

  it("Korean text reversed correctly", async () => {
    const { events } = await runClaude("안녕하세요");

    const asst = events.find(e => e.type === "assistant");
    const text = asst?.message?.content?.find((b: any) => b.type === "text")?.text;
    assert.ok(text?.includes("요세하녕안"), `Korean reversed, got: ${text}`);
  });

  it("exit code is 0 on success", async () => {
    const { code } = await runClaude("exit test");
    assert.equal(code, 0);
  });

  it("no permission denials in bypass mode", async () => {
    const { events } = await runClaude("perm check");

    const result = events.find(e => e.type === "result");
    assert.deepEqual(result?.permission_denials, []);
  });

  it("multiple requests accumulate in mock server", async () => {
    const before = mock.requests.length;
    await runClaude("first");
    await runClaude("second");
    await runClaude("third");

    assert.ok(mock.requests.length >= before + 3);
  });
});
