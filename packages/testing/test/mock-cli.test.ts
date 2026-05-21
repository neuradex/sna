import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createMockClaudeCli, createMockCodexExecCli, startMockAnthropicServer, startMockOpenAIServer } from "../src/index.js";

const execFileAsync = promisify(execFile);

function lines(stdout: string): any[] {
  return stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8", timeout: 5_000 });
  return stdout;
}

async function runClaudeStreamSession(command: string, input: string): Promise<any[]> {
  return await new Promise((resolve, reject) => {
    const proc = spawn(command, [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--model", "claude-sonnet-test",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const events: any[] = [];
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("mock Claude stream session timed out"));
    }, 5_000);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        events.push(event);
        if (event.type === "result") {
          proc.stdin.end();
        }
      }
    });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`mock Claude stream exited ${code}: ${stderr}`));
        return;
      }
      resolve(events);
    });

    proc.stdin.write(JSON.stringify({
      type: "user",
      message: { role: "user", content: input },
    }) + "\n");
  });
}

describe("mock runtime CLIs", () => {
  it("creates a Codex exec CLI that forwards model, instructions, effort, and service tier to the OpenAI mock", async () => {
    const openai = await startMockOpenAIServer({ responseText: "codex mock response" });
    const codex = createMockCodexExecCli(openai);
    try {
      const version = (await run(codex.command, ["--version"])).trim();
      assert.equal(version, "codex-cli mock-openai 0.0.0");

      const models = JSON.parse(await run(codex.command, ["debug", "models"]));
      assert.ok(models.models.some((model: any) => model.slug === "gpt-5.4"));

      const stdout = await run(codex.command, [
        "exec",
        "--model", "gpt-5.4",
        "-c", "developer_instructions=\"Loom instructions\"",
        "-c", "model_reasoning_effort=xhigh",
        "-c", "service_tier=priority",
        "hello codex",
      ], { encoding: "utf8" });

      const events = lines(stdout);
      assert.equal(events.filter((event) => event.type === "agent_message.delta").map((event) => event.delta).join(""), "codex mock response");
      assert.equal(events.at(-1).type, "turn.completed");
      assert.equal(openai.requests.length, 2);
      assert.equal(openai.requests[1].endpoint, "responses");
      assert.equal(openai.requests[1].model, "gpt-5.4");
      assert.equal(openai.requests[1].userText, "hello codex");
      assert.equal(openai.requests[1].authorization, "Bearer sk-codex-test");
      assert.deepEqual(openai.requests[1].requestBody.reasoning, { effort: "xhigh" });
      assert.equal(openai.requests[1].requestBody.service_tier, "priority");
      assert.equal(openai.requests[1].requestBody.instructions, "Loom instructions");
      assert.equal(codex.readInvocations().at(-1)?.argv.at(-1), "hello codex");
    } finally {
      codex.close();
      await openai.close();
    }
  });

  it("creates a Claude CLI that forwards prompt, model, and system prompt to the Anthropic mock", async () => {
    const anthropic = await startMockAnthropicServer();
    const claude = createMockClaudeCli(anthropic);
    try {
      const version = (await run(claude.command, ["--version"])).trim();
      assert.equal(version, "Claude Code mock-anthropic 0.0.0");

      const stdout = await run(claude.command, [
        "-p",
        "--output-format", "json",
        "--model", "claude-sonnet-test",
        "--system-prompt", "Loom system prompt",
        "hello claude",
      ], { encoding: "utf8" });
      const result = JSON.parse(stdout);

      assert.equal(result.type, "result");
      assert.equal(result.subtype, "success");
      assert.equal(result.result, "edualc olleh");
      assert.equal(anthropic.requests.length, 1);
      assert.equal(anthropic.requests[0].model, "claude-sonnet-test");
      assert.equal(anthropic.requests[0].stream, false);
      assert.equal(anthropic.requests[0].messages[0].content, "hello claude");
      assert.equal(claude.readInvocations().at(-1)?.argv.at(-1), "hello claude");
    } finally {
      claude.close();
      anthropic.close();
    }
  });

  it("emits Claude stream-json deltas for streaming provider tests", async () => {
    const anthropic = await startMockAnthropicServer();
    const claude = createMockClaudeCli(anthropic);
    try {
      const stdout = await run(claude.command, [
        "-p",
        "--output-format", "stream-json",
        "--model", "claude-sonnet-test",
        "stream me",
      ], { encoding: "utf8" });
      const events = lines(stdout);

      assert.equal(events[0].type, "system");
      assert.ok(events.some((event) => event.type === "stream_event" && event.event?.type === "content_block_delta"));
      assert.equal(events.at(-1).type, "result");
      assert.equal(events.at(-1).result, "em maerts ");
    } finally {
      claude.close();
      anthropic.close();
    }
  });

  it("supports Claude persistent stream-json stdin for spawn/startAgent tests", async () => {
    const anthropic = await startMockAnthropicServer();
    const claude = createMockClaudeCli(anthropic);
    try {
      const events = await runClaudeStreamSession(claude.command, "spawn smoke");

      assert.equal(events[0].type, "system");
      assert.ok(events.some((event) => event.type === "stream_event" && event.event?.type === "content_block_delta"));
      assert.equal(events.at(-1).type, "result");
      assert.equal(events.at(-1).result, "ekoms nwaps ");
      assert.equal(anthropic.requests.length, 1);
      assert.equal(anthropic.requests[0].messages[0].content, "spawn smoke");
    } finally {
      claude.close();
      anthropic.close();
    }
  });
});
