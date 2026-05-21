import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MockServer } from "./mock-api.js";
import type { MockOpenAIServer } from "./mock-openai.js";

export interface MockCliInvocation {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  timestamp: string;
}

export interface MockRuntimeCli {
  command: string;
  dir: string;
  invocationsFile: string;
  readInvocations(): MockCliInvocation[];
  close(): void;
}

export interface MockCodexExecCliOptions {
  apiKey?: string;
}

export interface MockClaudeCliOptions {
  apiKey?: string;
  defaultModel?: string;
}

function executableScript(dir: string, name: string, body: string): string {
  const script = path.join(dir, `${name}.js`);
  fs.writeFileSync(script, body);
  fs.chmodSync(script, 0o755);
  return script;
}

function createCliHandle(dir: string, command: string, invocationsFile: string): MockRuntimeCli {
  return {
    command,
    dir,
    invocationsFile,
    readInvocations() {
      if (!fs.existsSync(invocationsFile)) return [];
      return fs.readFileSync(invocationsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    close() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function openAIUrl(input: string | MockOpenAIServer): string {
  return typeof input === "string" ? input : input.url;
}

function anthropicUrl(input: string | MockServer): string {
  return typeof input === "string" ? input : `http://127.0.0.1:${input.port}`;
}

export function createMockCodexExecCli(
  input: string | MockOpenAIServer,
  options: MockCodexExecCliOptions = {},
): MockRuntimeCli {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-mock-codex-"));
  const invocationsFile = path.join(dir, "invocations.jsonl");
  const endpoint = openAIUrl(input);
  const apiKey = options.apiKey ?? "sk-codex-test";
  const command = executableScript(dir, "codex", `#!/usr/bin/env node
const fs = require("node:fs");
const endpoint = ${JSON.stringify(endpoint)};
const apiKey = ${JSON.stringify(apiKey)};
const invocationsFile = ${JSON.stringify(invocationsFile)};
const args = process.argv.slice(2);

function record() {
  const env = {};
  for (const key of ["SNA_SESSION_ID", "LOOM_SESSION_ID", "LOOM_API_URL", "MOCK_OPENAI_URL", "OPENAI_API_KEY"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  fs.appendFileSync(invocationsFile, JSON.stringify({ argv: args, cwd: process.cwd(), env, timestamp: new Date().toISOString() }) + "\\n");
}

function configValue(raw) {
  const idx = raw.indexOf("=");
  if (idx === -1) return [raw, ""];
  return [raw.slice(0, idx), raw.slice(idx + 1)];
}

function decodeConfigValue(value) {
  try { return JSON.parse(value); } catch { return value; }
}

async function main() {
  record();
  if (args[0] === "--version") {
    console.log("codex-cli mock-openai 0.0.0");
    return;
  }
  if (args[0] === "debug" && args[1] === "models") {
    const res = await fetch(endpoint + "/v1/models", {
      headers: { Authorization: "Bearer " + apiKey },
    });
    const body = await res.json();
    console.log(JSON.stringify({
      models: body.data.map((m) => ({
        slug: m.id,
        display_name: String(m.id).toUpperCase(),
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
      if (key === "developer_instructions") instructions = decodeConfigValue(value);
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
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
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
  return createCliHandle(dir, command, invocationsFile);
}

export function createMockClaudeCli(
  input: string | MockServer,
  options: MockClaudeCliOptions = {},
): MockRuntimeCli {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-mock-claude-"));
  const invocationsFile = path.join(dir, "invocations.jsonl");
  const endpoint = anthropicUrl(input);
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const defaultModel = options.defaultModel ?? "claude-mock";
  const command = executableScript(dir, "claude", `#!/usr/bin/env node
const fs = require("node:fs");
const endpoint = ${JSON.stringify(endpoint)};
const apiKey = ${JSON.stringify(apiKey)};
const defaultModel = ${JSON.stringify(defaultModel)};
const invocationsFile = ${JSON.stringify(invocationsFile)};
const args = process.argv.slice(2);

function record() {
  const env = {};
  for (const key of ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "SNA_SESSION_ID", "LOOM_SESSION_ID", "LOOM_API_URL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  fs.appendFileSync(invocationsFile, JSON.stringify({ argv: args, cwd: process.cwd(), env, timestamp: new Date().toISOString() }) + "\\n");
}

function textFromAnthropicContent(content) {
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}

function usageFor(text) {
  const tokens = Math.max(1, Math.ceil(String(text).length / 4));
  return {
    input_tokens: tokens,
    output_tokens: tokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

function emitJsonLine(value) {
  console.log(JSON.stringify(value));
}

function parseArgs() {
  let outputFormat = "text";
  let inputFormat = "text";
  let printMode = false;
  let model = defaultModel;
  let systemPrompt = "";
  let appendSystemPrompt = "";
  let prompt = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version") return { version: true };
    if (arg === "-p" || arg === "--print") {
      printMode = true;
      continue;
    }
    if (arg === "--verbose" || arg === "--include-partial-messages" || arg === "--no-session-persistence") continue;
    if (arg === "--output-format") {
      outputFormat = args[++i] ?? outputFormat;
      continue;
    }
    if (arg === "--input-format") {
      inputFormat = args[++i] ?? inputFormat;
      continue;
    }
    if (arg === "--model") {
      model = args[++i] ?? model;
      continue;
    }
    if (arg === "--system-prompt") {
      systemPrompt = args[++i] ?? "";
      continue;
    }
    if (arg === "--append-system-prompt") {
      appendSystemPrompt = args[++i] ?? "";
      continue;
    }
    if (arg === "--permission-mode" || arg === "--effort") {
      i++;
      continue;
    }
    prompt = arg;
  }
  return {
    outputFormat,
    inputFormat,
    printMode,
    model,
    system: [systemPrompt, appendSystemPrompt].filter(Boolean).join("\\n\\n"),
    prompt,
  };
}

async function completeAnthropic(parsed, prompt) {
  const res = await fetch(endpoint + "/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      model: parsed.model,
      system: parsed.system || undefined,
      stream: false,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const error = await res.text();
    console.error(error);
    process.exit(1);
  }
  const body = await res.json();
  return textFromAnthropicContent(body.content);
}

function resultPayload(parsed, text, usage, modelUsage) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: "mock-claude-session",
    duration_ms: 1,
    duration_api_ms: 1,
    total_cost_usd: 0,
    usage,
    modelUsage,
  };
}

function emitStream(parsed, text) {
  const usage = usageFor(text);
  const modelUsage = {
    [parsed.model]: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    },
  };

  const messageId = "msg_mock_cli_" + Date.now();
  emitJsonLine({ type: "stream_event", event: { type: "message_start", message: { id: messageId, type: "message", role: "assistant", model: parsed.model, content: [] } } });
  emitJsonLine({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  let streamed = "";
  for (const word of text.split(" ")) {
    const delta = word + " ";
    streamed += delta;
    emitJsonLine({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } } });
  }
  emitJsonLine({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  emitJsonLine({ type: "stream_event", event: { type: "message_stop" } });
  emitJsonLine(resultPayload(parsed, streamed, usage, modelUsage));
}

function userTextFromStreamJson(line) {
  const msg = JSON.parse(line);
  if (msg.type !== "user") return null;
  const content = msg.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "string" ? part : (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

async function runPersistent(parsed) {
  emitJsonLine({ type: "system", subtype: "init", session_id: "mock-claude-session", model: parsed.model, apiKeySource: "ANTHROPIC_API_KEY" });
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split("\\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const text = userTextFromStreamJson(line);
      if (text == null) continue;
      emitStream(parsed, await completeAnthropic(parsed, text));
    }
  }
}

async function main() {
  record();
  const parsed = parseArgs();
  if (parsed.version) {
    console.log("Claude Code mock-anthropic 0.0.0");
    return;
  }

  if (parsed.inputFormat === "stream-json" && !parsed.printMode) {
    await runPersistent(parsed);
    return;
  }

  const text = await completeAnthropic(parsed, parsed.prompt);

  if (parsed.outputFormat === "json") {
    const usage = usageFor(text);
    const modelUsage = {
      [parsed.model]: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      },
    };
    console.log(JSON.stringify(resultPayload(parsed, text, usage, modelUsage)));
    return;
  }

  if (parsed.outputFormat === "stream-json") {
    emitJsonLine({ type: "system", subtype: "init", session_id: "mock-claude-session", model: parsed.model, apiKeySource: "ANTHROPIC_API_KEY" });
    emitStream(parsed, text);
    return;
  }

  console.log(text);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
`);
  return createCliHandle(dir, command, invocationsFile);
}
