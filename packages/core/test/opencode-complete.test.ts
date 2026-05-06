/**
 * OpenCodeProvider.complete() tests against the mock HTTP server.
 *
 * complete() is the one-shot path — no session manager, no SSE iteration.
 * The mock server's POST /session/:id/message handler returns a sync
 * AssistantMessage payload, which is what the SDK's session.prompt method
 * calls. Tests use `providerOptions.serverUrl` to short-circuit
 * createOpencodeServer (which would spawn the real opencode binary).
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenCodeProvider } from "../src/core/providers/opencode.js";
import { startMockOpenCodeServer, type MockOpenCodeServer } from "./mock-opencode-server.js";

describe("OpenCodeProvider.complete() against mock server", () => {
  let mock: MockOpenCodeServer;
  const provider = new OpenCodeProvider();

  before(async () => { mock = await startMockOpenCodeServer(); });
  after(async () => { await mock.close(); });
  beforeEach(() => { mock.reset(); });

  it("returns aggregated text + token usage from the AssistantMessage", async () => {
    const result = await provider.complete({
      prompt: "ping",
      providerOptions: { serverUrl: mock.url },
    });
    assert.equal(result.text, "Hello world");
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);
    assert.equal(result.usage.cacheReadTokens, 0);
    assert.equal(result.usage.cacheCreationTokens, 0);
    assert.ok(result.durationMs >= 0);
    assert.equal(result.model, "claude-sonnet-4-6");
  });

  it("creates a fresh session per call and deletes it afterward", async () => {
    await provider.complete({
      prompt: "first",
      providerOptions: { serverUrl: mock.url },
    });
    await provider.complete({
      prompt: "second",
      providerOptions: { serverUrl: mock.url },
    });

    const creates = mock.requestsFor((r) =>
      r.method === "POST" && /^\/session(\?|$)/.test(r.url),
    );
    assert.equal(creates.length, 2, "exactly two session creations");

    // Best-effort cleanup is fire-and-forget; let it land before asserting.
    await new Promise((r) => setTimeout(r, 50));

    const deletes = mock.requestsFor((r) =>
      r.method === "DELETE" && /^\/session\/[^\/]+(\?|$)/.test(r.url),
    );
    assert.ok(deletes.length >= 2, `expected at least two deletes, got ${deletes.length}`);
  });

  it("passes parsed { providerID, modelID } and explicit agent through", async () => {
    await provider.complete({
      prompt: "hi",
      model: "anthropic/claude-sonnet-4-6",
      providerOptions: { serverUrl: mock.url, agent: "plan" },
    });

    const promptCalls = mock.requestsFor((r) =>
      r.method === "POST" && /\/session\/[^\/]+\/message(\?|$)/.test(r.url),
    );
    assert.equal(promptCalls.length, 1);
    const body = promptCalls[0].body as {
      parts: Array<{ type: string; text?: string }>;
      model?: { providerID: string; modelID: string };
      agent?: string;
    };
    assert.deepEqual(body.parts, [{ type: "text", text: "hi" }]);
    assert.deepEqual(body.model, { providerID: "anthropic", modelID: "claude-sonnet-4-6" });
    assert.equal(body.agent, "plan");
  });

  it("merges systemPrompt + appendSystemPrompt into body.system", async () => {
    await provider.complete({
      prompt: "x",
      systemPrompt: "Base instructions.",
      appendSystemPrompt: "Be terse.",
      providerOptions: { serverUrl: mock.url },
    });
    const promptCalls = mock.requestsFor((r) =>
      r.method === "POST" && /\/session\/[^\/]+\/message(\?|$)/.test(r.url),
    );
    const body = promptCalls[0].body as { system?: string };
    assert.equal(body.system, "Base instructions.\n\nBe terse.");
  });

  it("does not pass system when both prompts are absent", async () => {
    await provider.complete({
      prompt: "x",
      providerOptions: { serverUrl: mock.url },
    });
    const promptCalls = mock.requestsFor((r) =>
      r.method === "POST" && /\/session\/[^\/]+\/message(\?|$)/.test(r.url),
    );
    const body = promptCalls[0].body as { system?: string };
    assert.equal(body.system, undefined);
  });
});
