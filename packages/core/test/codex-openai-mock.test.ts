import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexProvider } from "../src/core/providers/codex.js";
import { startMockOpenAIServer, type MockOpenAIServer } from "../../testing/src/index.js";

interface MockCodexExecCli {
  command: string;
  close(): void;
}

function createMockCodexExecCli(openAIUrl: string): MockCodexExecCli {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-codex-exec-"));
  const script = path.join(dir, "codex-exec-openai.js");
  const command = path.join(dir, "codex");
  fs.writeFileSync(script, `
const endpoint = process.env.MOCK_OPENAI_URL;
const args = process.argv.slice(2);

function configValue(raw) {
  const idx = raw.indexOf("=");
  if (idx === -1) return [raw, ""];
  return [raw.slice(0, idx), raw.slice(idx + 1)];
}

async function main() {
  if (args[0] === "--version") {
    console.log("codex-cli mock-openai 0.0.0");
    return;
  }
  if (args[0] === "debug" && args[1] === "models") {
    const res = await fetch(endpoint + "/v1/models");
    const body = await res.json();
    console.log(JSON.stringify({
      models: body.data.map((m) => ({
        slug: m.id,
        display_name: m.id.toUpperCase(),
        visibility: "list",
        supported_in_api: true,
      })),
    }));
    return;
  }
  if (args[0] !== "exec") {
    console.error("unsupported codex mock args: " + args.join(" "));
    process.exit(2);
  }

  let model = "codex-default";
  let prompt = args[args.length - 1] ?? "";
  let instructions;
  let effort;
  let serviceTier;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      model = args[++i] ?? model;
      continue;
    }
    if (arg === "-c") {
      const [key, value] = configValue(args[++i] ?? "");
      if (key === "developer_instructions") {
        try { instructions = JSON.parse(value); } catch { instructions = value; }
      }
      if (key === "model_reasoning_effort") effort = value;
      if (key === "service_tier") serviceTier = value;
    }
  }

  const request = {
    model,
    input: prompt,
    ...(instructions ? { instructions } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(serviceTier ? { service_tier: serviceTier } : {}),
  };
  const res = await fetch(endpoint + "/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-codex-test" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    console.log(JSON.stringify({ type: "turn.failed", error: { message: await res.text() } }));
    process.exit(1);
  }
  const body = await res.json();
  const text = body.output_text
    ?? body.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("")
    ?? "";

  const midpoint = Math.max(1, Math.floor(text.length / 2));
  console.log(JSON.stringify({ type: "agent_message.delta", delta: text.slice(0, midpoint) }));
  console.log(JSON.stringify({ type: "agent_message.delta", delta: text.slice(midpoint) }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
  console.log(JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: body.usage?.input_tokens ?? 0,
      cached_input_tokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: body.usage?.output_tokens ?? 0,
    },
  }));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
`);
  fs.writeFileSync(command, `#!/usr/bin/env bash\nexec env MOCK_OPENAI_URL="${openAIUrl}" node "${script}" "$@"\n`);
  fs.chmodSync(command, 0o755);
  return {
    command,
    close() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("CodexProvider.complete() with @sna-sdk/testing OpenAI mock", () => {
  let mock: MockOpenAIServer;
  let cli: MockCodexExecCli;
  const origCommand = process.env.SNA_CODEX_COMMAND;

  beforeEach(async () => {
    mock = await startMockOpenAIServer({ responseText: "codex mock response" });
    cli = createMockCodexExecCli(mock.url);
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
