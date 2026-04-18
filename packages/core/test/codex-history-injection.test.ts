/**
 * Cross-provider history injection into Codex.
 *
 * Exercises CodexProvider.spawn end-to-end via a stubbed codex app-server.
 * The real unit under test is the path from `options.history` (CanonicalBlock[])
 * through `canonicalToCodexResponseItems` into the `thread/resume` JSON-RPC
 * payload — i.e. "when we switch from Claude to Codex mid-session, what does
 * Codex actually see?"
 *
 * These tests caught two regressions during development:
 *   1. "Continue from where we left off" was being synthesized as a fake user
 *      turn, polluting the chat UI. Now the history lives in thread/resume's
 *      `history` field and no synthesized turn is sent.
 *   2. Cross-provider restart was inheriting Claude-specific --settings via
 *      extraArgs and crashing Codex with exit 2. SpawnOptions no longer
 *      propagates provider-specific flags across providers.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CodexProvider } from "../src/core/providers/codex.js";
import type { CanonicalBlock } from "../src/history/types.js";
import { startMockCodexAppServer, type MockCodexServer } from "./mock-codex-app-server.js";

/** Wait until the predicate is true or the timeout elapses. */
async function waitFor(fn: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("CodexProvider cross-provider history injection", () => {
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

  beforeEach(() => {
    // Each test gets a clean request log — otherwise slice(-1)[0] races with
    // earlier tests' captured thread/resume calls.
    mock.reset();
  });

  it("text-only history is injected via thread/resume(history=ResponseItems)", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "I'm Yoonsu." },
      { actor: "assistant", kind: "text", content: "Nice to meet you, Yoonsu." },
    ];
    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), history });

    // Wait for init handshake + thread/resume to complete.
    await waitFor(() => mock.requestsFor("thread/resume").length > 0);
    proc.kill();

    const resumes = mock.requestsFor("thread/resume");
    assert.equal(resumes.length, 1, "exactly one thread/resume should fire");

    const params = resumes[0].params as { history?: Array<{ type: string; role?: string; content?: unknown[] }> };
    assert.ok(Array.isArray(params.history), "resume params must include history");
    assert.equal(params.history!.length, 2);
    assert.deepEqual(params.history![0], {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "I'm Yoonsu." }],
    });
    assert.deepEqual(params.history![1], {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Nice to meet you, Yoonsu." }],
    });
  });

  it("tool_use + tool_result map to FunctionCall + FunctionCallOutput", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "list files" },
      { actor: "assistant", kind: "text", content: "I'll run ls." },
      { actor: "assistant", kind: "tool_use", content: "Bash",
        meta: { id: "call_ls", input: { command: "ls" } } },
      { actor: "system", kind: "tool_result", content: "a.txt\nb.txt",
        meta: { toolUseId: "call_ls" } },
      { actor: "assistant", kind: "text", content: "Two files." },
    ];
    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), history });

    await waitFor(() => mock.requestsFor("thread/resume").length > 0);
    proc.kill();

    const params = mock.requestsFor("thread/resume").slice(-1)[0].params as { history: Array<any> };
    // Expected sequence:
    //   user message → assistant message → function_call → function_call_output → assistant message
    const types = params.history.map((it: any) => it.type);
    assert.deepEqual(types, [
      "message", "message", "function_call", "function_call_output", "message",
    ]);
    const call = params.history[2];
    assert.equal(call.name, "Bash");
    assert.equal(call.call_id, "call_ls");
    assert.equal(call.arguments, JSON.stringify({ command: "ls" }));
    const output = params.history[3];
    assert.equal(output.call_id, "call_ls");
    assert.equal(output.output, "a.txt\nb.txt");
  });

  it("thinking blocks become Reasoning items", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "hi" },
      { actor: "assistant", kind: "thinking", content: "thinking..." },
      { actor: "assistant", kind: "text", content: "hello" },
    ];
    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), history });
    await waitFor(() => mock.requestsFor("thread/resume").length > 0);
    proc.kill();

    const params = mock.requestsFor("thread/resume").slice(-1)[0].params as { history: Array<any> };
    const types = params.history.map((it: any) => it.type);
    assert.deepEqual(types, ["message", "reasoning", "message"]);
    assert.equal(params.history[1].summary[0].text, "thinking...");
  });

  it("experimental feature flag is enabled before thread/resume when history is present", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "hello" },
    ];
    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), history });
    await waitFor(() => mock.requestsFor("thread/resume").length > 0);
    proc.kill();

    const all = mock.readRequests();
    const enableIdx = all.findIndex(
      (r) => r.method === "experimentalFeature/enablement/set"
        && (r.params as any)?.enablement?.["thread/resume.history"] === true,
    );
    const resumeIdx = all.findIndex((r) => r.method === "thread/resume");
    assert.ok(enableIdx >= 0, "experimentalFeature/enablement/set was not sent");
    assert.ok(enableIdx < resumeIdx, "feature flag must be set BEFORE thread/resume fires");
  });

  it("no prompt + history: does NOT synthesize a fake 'Continue from where we left off' turn", async () => {
    // Regression guard for the XML-prefix-as-fake-user-turn bug.
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "original question" },
      { actor: "assistant", kind: "text", content: "original answer" },
    ];
    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), history });
    await waitFor(() => mock.requestsFor("thread/resume").length > 0);
    // Give a short grace for any stray turn/start to arrive.
    await new Promise((r) => setTimeout(r, 50));
    proc.kill();

    const turnStarts = mock.requestsFor("turn/start");
    assert.equal(turnStarts.length, 0, "no turn/start should be sent when caller passes no prompt");
  });
});
