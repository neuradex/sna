import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CodexProvider } from "../src/core/providers/codex.js";
import { createMockCodexExecCli, startMockOpenAIServer, type MockOpenAIServer, type MockRuntimeCli } from "../../testing/src/index.js";

describe("CodexProvider.complete() with @sna-sdk/testing OpenAI mock", () => {
  let mock: MockOpenAIServer;
  let cli: MockRuntimeCli;
  const origCommand = process.env.SNA_CODEX_COMMAND;

  beforeEach(async () => {
    mock = await startMockOpenAIServer({ responseText: "codex mock response" });
    cli = createMockCodexExecCli(mock);
    process.env.SNA_CODEX_COMMAND = cli.command;
  });

  afterEach(async () => {
    if (origCommand === undefined) delete process.env.SNA_CODEX_COMMAND;
    else process.env.SNA_CODEX_COMMAND = origCommand;
    cli.close();
    await mock.close();
  });

  it("routes the ephemeral codex exec path through the OpenAI Responses mock", async () => {
    const provider = new CodexProvider();
    const result = await provider.complete({
      prompt: "hello codex",
      model: "gpt-5.4",
      timeout: 5000,
    });

    assert.equal(result.text, "codex mock response");
    assert.equal(result.model, "gpt-5.4");
    assert.ok(result.usage.inputTokens > 0);
    assert.ok(result.usage.outputTokens > 0);
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].endpoint, "responses");
    assert.equal(mock.requests[0].model, "gpt-5.4");
    assert.equal(mock.requests[0].userText, "hello codex");
    assert.equal(mock.requests[0].authorization, "Bearer sk-codex-test");
  });

  it("forwards reasoningLevel, serviceTier, and merged instructions to codex exec", async () => {
    const provider = new CodexProvider();
    await provider.complete({
      prompt: "latency sensitive",
      model: "gpt-5.4",
      reasoningLevel: 5,
      systemPrompt: "Base instructions.",
      appendSystemPrompt: "More constraints.",
      providerOptions: { serviceTier: "priority" },
      timeout: 5000,
    });

    const body = mock.requests[0].requestBody as any;
    assert.deepEqual(body.reasoning, { effort: "xhigh" });
    assert.equal(body.service_tier, "priority");
    assert.equal(body.instructions, "Base instructions.\n\nMore constraints.");
  });

  it("forwards streaming deltas from codex exec stdout to onDelta", async () => {
    const provider = new CodexProvider();
    const deltas: string[] = [];
    const result = await provider.complete({
      prompt: "stream please",
      model: "gpt-5.4-mini",
      onDelta: (delta) => deltas.push(delta),
      timeout: 5000,
    });

    assert.equal(result.text, "codex mock response");
    assert.equal(deltas.join(""), "codex mock response");
    assert.ok(deltas.length >= 2);
  });
});
