import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeProvider, CodexProvider } from "../src/core/providers/index.js";
import {
  createClaudeMockEnv,
  createCodexMockEnv,
  startMockAnthropicServer,
  startMockOpenAIServer,
  type MockOpenAIServer,
  type MockServer,
} from "../../testing/src/index.js";

function commandAvailable(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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
  const originalClaudeCommand = process.env.SNA_CLAUDE_COMMAND;
  const originalCodexCommand = process.env.SNA_CODEX_COMMAND;

  afterEach(async () => {
    if (originalClaudeCommand === undefined) delete process.env.SNA_CLAUDE_COMMAND;
    else process.env.SNA_CLAUDE_COMMAND = originalClaudeCommand;
    if (originalCodexCommand === undefined) delete process.env.SNA_CODEX_COMMAND;
    else process.env.SNA_CODEX_COMMAND = originalCodexCommand;
    anthropic?.close();
    anthropic = null;
    if (openai) await openai.close();
    openai = null;
  });

  it("runs real Claude Code against the mock Anthropic API and captures streaming request shape", {
    skip: !commandAvailable("claude") ? "claude CLI is not installed" : undefined,
    timeout: 45_000,
  }, async () => {
    delete process.env.SNA_CLAUDE_COMMAND;
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
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("runs real Codex against the mock OpenAI Responses API and captures request shape", {
    skip: !commandAvailable("codex") ? "codex CLI is not installed" : undefined,
    timeout: 45_000,
  }, async () => {
    delete process.env.SNA_CODEX_COMMAND;
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
      fs.rmSync(codexHomeRoot, { recursive: true, force: true });
    }
  });
});
