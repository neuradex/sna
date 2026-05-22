import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeProvider, CodexProvider, GrokProvider, OpenCodeProvider } from "../src/core/providers/index.js";
import {
  createClaudeMockEnv,
  createCodexMockEnv,
  createGrokMockEnv,
  createOpenCodeMockConfig,
  startMockAnthropicServer,
  startMockOpenAIServer,
  waitForRequest,
  type MockOpenAIServer,
  type MockServer,
} from "../../testing/src/index.js";
import type { AgentProcess } from "../src/core/providers/types.js";
import type { RuntimeHandle } from "../src/core/providers/runtime.js";

function commandAvailable(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runtimeCliSkip(command: string, envVar: string): string | undefined {
  if (process.env[envVar]) return undefined;
  return commandAvailable(command) ? undefined : `${command} CLI is not installed; set ${envVar}=<path> to run this test`;
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function removeTempDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
  }
  return system ? JSON.stringify(system) : "";
}

describe("real runtime CLIs with mock-attached LLM APIs", () => {
  let anthropic: MockServer | null = null;
  let openai: MockOpenAIServer | null = null;
  let opencodeProcess: AgentProcess | null = null;
  let opencodeRuntime: RuntimeHandle | null = null;
  let grokProcess: AgentProcess | null = null;
  const originalClaudeCommand = process.env.SNA_CLAUDE_COMMAND;
  const originalCodexCommand = process.env.SNA_CODEX_COMMAND;
  const originalOpenCodeCommand = process.env.SNA_OPENCODE_COMMAND;
  const originalGrokCommand = process.env.SNA_GROK_COMMAND;

  afterEach(async () => {
    if (originalClaudeCommand === undefined) delete process.env.SNA_CLAUDE_COMMAND;
    else process.env.SNA_CLAUDE_COMMAND = originalClaudeCommand;
    if (originalCodexCommand === undefined) delete process.env.SNA_CODEX_COMMAND;
    else process.env.SNA_CODEX_COMMAND = originalCodexCommand;
    if (originalOpenCodeCommand === undefined) delete process.env.SNA_OPENCODE_COMMAND;
    else process.env.SNA_OPENCODE_COMMAND = originalOpenCodeCommand;
    if (originalGrokCommand === undefined) delete process.env.SNA_GROK_COMMAND;
    else process.env.SNA_GROK_COMMAND = originalGrokCommand;
    anthropic?.close();
    anthropic = null;
    grokProcess?.kill();
    grokProcess = null;
    opencodeProcess?.kill();
    opencodeProcess = null;
    opencodeRuntime?.dispose();
    opencodeRuntime = null;
    if (openai) await openai.close();
    openai = null;
  });

  it("runs real Claude Code against the mock Anthropic API and captures streaming request shape", {
    skip: runtimeCliSkip("claude", "SNA_CLAUDE_COMMAND"),
    timeout: 45_000,
  }, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-real-claude-mock-"));
    anthropic = await startMockAnthropicServer();

    try {
      const mockEnv = createClaudeMockEnv({
        cwd,
        anthropicBaseUrl: `http://127.0.0.1:${anthropic.port}`,
        configDir: path.join(cwd, "claude-config"),
        extraEnv: {
          SNA_SESSION_ID: "sna-real-claude-session",
          LOOM_API_URL: "http://127.0.0.1:57787",
        },
      });
      const deltas: string[] = [];
      const result = await new ClaudeCodeProvider().complete({
        cwd,
        prompt: "mock attached claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "SNA mock-attached Claude system prompt",
        extraArgs: ["--bare", "--permission-mode", "bypassPermissions", "--setting-sources", ""],
        env: mockEnv.env,
        onDelta: (delta) => deltas.push(delta),
        timeout: 30_000,
      });

      assert.match(result.text, /edualc dehcatta kcom/);
      assert.ok(deltas.join("").includes("edualc"), "Claude provider should surface stdout stream deltas");
      assert.ok(anthropic.requests.length >= 1, "real Claude CLI should call the mock Anthropic API");

      const request = anthropic.requests.find((entry) =>
        systemText(entry.requestBody?.system).includes("SNA mock-attached Claude system prompt"),
      );
      assert.ok(request, "mock should capture the request carrying the SNA system prompt");
      assert.equal(request.model, "claude-sonnet-4-6");
      assert.equal(request.stream, true);
      assert.equal(request.userText, "mock attached claude");
      assert.equal(systemText(request.requestBody?.system).includes("SNA mock-attached Claude system prompt"), true);
    } finally {
      await removeTempDir(cwd);
    }
  });

  it("runs real Codex against the mock OpenAI Responses API and captures request shape", {
    skip: runtimeCliSkip("codex", "SNA_CODEX_COMMAND"),
    timeout: 45_000,
  }, async () => {
    const cwd = process.cwd();
    const codexHomeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sna-real-codex-mock-"));
    openai = await startMockOpenAIServer({ responseText: "codex mock-attached response" });

    try {
      const mockEnv = createCodexMockEnv({
        cwd,
        openAIBaseUrl: openai.url,
        codexHome: path.join(codexHomeRoot, "codex-home"),
        apiKey: "sk-codex-mock-attached",
        model: "gpt-5.4",
      });
      const deltas: string[] = [];
      const result = await new CodexProvider().complete({
        cwd,
        prompt: "mock attached codex",
        model: "gpt-5.4",
        systemPrompt: "SNA mock-attached Codex system prompt",
        reasoningLevel: 4,
        providerOptions: { serviceTier: "priority" },
        env: mockEnv.env,
        onDelta: (delta) => deltas.push(delta),
        timeout: 30_000,
      });

      assert.equal(result.text, "codex mock-attached response");
      assert.equal(openai.requests.length, 1);
      const request = openai.requests[0];
      assert.equal(request.endpoint, "responses");
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.authorization, "Bearer sk-codex-mock-attached");
      assert.equal(request.model, "gpt-5.4");
      assert.equal(request.userText, "mock attached codex");
      assert.equal(JSON.stringify(request.requestBody).includes("SNA mock-attached Codex system prompt"), true);
      assert.deepEqual(request.requestBody?.reasoning, { effort: "high" });
      assert.equal(request.requestBody?.service_tier, "priority");
      assert.ok(Array.isArray(deltas), "Codex delta capture should be wired even when this CLI emits final-only JSONL");
    } finally {
      await removeTempDir(codexHomeRoot);
    }
  });

  it("runs real OpenCode against the mock OpenAI Chat Completions API and captures streaming request shape", {
    skip: runtimeCliSkip("opencode", "SNA_OPENCODE_COMMAND"),
    timeout: 45_000,
  }, async () => {
    const cwd = process.cwd();
    openai = await startMockOpenAIServer({
      responseText: (ctx) => ctx.userText.includes("mock attached opencode") ? "Done." : "Ok.",
      chunkSize: 1000,
    });
    const mockConfig = createOpenCodeMockConfig({
      openAIBaseUrl: openai.url,
      apiKey: "sk-opencode-mock-attached",
      providerId: "sna-mock",
      modelId: "sna-model",
    });
    const provider = new OpenCodeProvider();

    opencodeRuntime = await provider.prepareRuntime({
      cwd,
      model: mockConfig.model,
      providerOptions: {
        ...mockConfig.providerOptions,
        logLevel: "ERROR",
      },
    });
    opencodeProcess = provider.spawn({
      cwd,
      prompt: "mock attached opencode",
      model: mockConfig.model,
      systemPrompt: "SNA mock-attached OpenCode system prompt",
      providerOptions: mockConfig.providerOptions,
      timeout: 30_000,
    }, opencodeRuntime);

    const request = await waitForRequest(openai, (entry) =>
      entry.endpoint === "chat.completions"
      && entry.userText === "mock attached opencode"
      && JSON.stringify(entry.requestBody).includes("SNA mock-attached OpenCode system prompt"),
    { timeoutMs: 15_000 });

    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.authorization, "Bearer sk-opencode-mock-attached");
    assert.equal(request.model, "sna-model");
    assert.equal(request.stream, true);
    assert.equal(request.userText, "mock attached opencode");
    assert.equal(JSON.stringify(request.requestBody).includes("SNA mock-attached OpenCode system prompt"), true);
    assert.ok(
      Array.isArray(request.requestBody?.messages),
      "OpenCode should send OpenAI-compatible chat messages",
    );
  });

  it("runs real Grok Build against the mock OpenAI Responses API and captures streaming request shape", {
    skip: runtimeCliSkip("grok", "SNA_GROK_COMMAND"),
    timeout: 60_000,
  }, async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-real-grok-mock-"));
    const events: any[] = [];
    openai = await startMockOpenAIServer({
      models: [{ id: "grok-build", object: "model", created: 0, owned_by: "xai" }],
      responseText: (ctx) => ctx.userText.includes("mock attached grok") ? "OK" : "Mock Grok title",
      chunkSize: 1000,
    });
    const mockEnv = createGrokMockEnv({
      cwd,
      openAIBaseUrl: openai.url,
      apiKey: "sk-grok-mock-attached",
      model: "grok-build",
    });

    try {
      grokProcess = new GrokProvider().spawn({
        cwd,
        prompt: "Reply with exactly OK for mock attached grok and do not use tools.",
        model: mockEnv.model,
        permissionMode: "bypassPermissions",
        systemPrompt: "SNA mock-attached Grok system prompt",
        env: mockEnv.env,
        providerOptions: mockEnv.providerOptions,
      });
      grokProcess.on("event", (event) => events.push(event));

      const request = await waitForRequest(openai, (entry) =>
        entry.endpoint === "responses"
        && entry.userText.includes("mock attached grok")
        && JSON.stringify(entry.requestBody).includes("SNA mock-attached Grok system prompt"),
      { timeoutMs: 20_000 });

      assert.equal(request.url, "/v1/responses");
      assert.equal(request.authorization, "Bearer sk-grok-mock-attached");
      assert.equal(request.model, "grok-build");
      assert.equal(request.stream, true);
      assert.equal(request.userText.includes("mock attached grok"), true);
      assert.equal(JSON.stringify(request.requestBody).includes("SNA mock-attached Grok system prompt"), true);
      assert.ok(
        Array.isArray(request.requestBody?.input),
        "Grok Build should send OpenAI-compatible Responses input",
      );
      await waitUntil(
        () => events.some((event) => event.type === "assistant_delta" && String(event.delta ?? "").includes("OK")),
        "Grok Build assistant stream delta",
        10_000,
      );
    } finally {
      grokProcess?.kill();
      grokProcess = null;
      await removeTempDir(cwd);
    }
  });
});
