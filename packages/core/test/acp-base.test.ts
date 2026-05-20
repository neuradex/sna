import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AcpStdioProcess, buildSystemPromptText, serializeHistoryForAcp } from "../src/core/providers/acp/base.js";
import type { AcpSpawnDescriptor } from "../src/core/providers/acp/base.js";
import type { AgentEvent, SpawnOptions } from "../src/core/providers/types.js";

let mockAgentPath = "";
const processes: TestAcpProcess[] = [];
const tempDirs: string[] = [];

class TestAcpProcess extends AcpStdioProcess {
  protected get name() { return "test-acp"; }

  protected resolveSpawn(_options: SpawnOptions): AcpSpawnDescriptor {
    return { command: process.execPath, args: [mockAgentPath] };
  }
}

function writeMockAgent(mode: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-acp-mock-"));
  tempDirs.push(dir);
  const script = path.join(dir, "mock-acp-agent.mjs");
  const logPath = path.join(dir, "wire.jsonl");
  fs.writeFileSync(script, `
import fs from "node:fs";
import readline from "node:readline";

const mode = process.env.MOCK_ACP_MODE ?? "";
const logPath = process.env.MOCK_ACP_LOG;
let sessionId = "acp-session-1";

function log(entry) {
  if (logPath) fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n");
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function notify(update) {
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  log({ in: msg });

  if (msg.id && !msg.method) {
    log({ response: msg });
    return;
  }

  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } });
    return;
  }

  if (msg.method === "session/new") {
    send({ jsonrpc: "2.0", id: msg.id, result: { sessionId } });
    return;
  }

  if (msg.method === "session/prompt") {
    if (mode.includes("updates")) {
      notify({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "plan" } });
      notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } });
      notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } });
      notify({ sessionUpdate: "tool_call", toolCallId: "tool-1", kind: "read", title: "Read", rawInput: { file: "a.ts" } });
      notify({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", kind: "read", title: "Read", rawInput: { file: "b.ts" } });
      notify({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", kind: "read", title: "Read", status: "completed", rawOutput: "ok", locations: [{ path: "b.ts" }] });
    }

    if (mode.includes("permission")) {
      send({
        jsonrpc: "2.0",
        id: 100,
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: { toolCallId: "perm-1", kind: "shell", title: "Bash", rawInput: { command: "rm -rf tmp" } },
          options: [
            { optionId: "allow-always", kind: "allow_always" },
            { optionId: "allow-once", kind: "allow_once" },
            { optionId: "reject-once", kind: "reject_once" },
            { optionId: "reject-always", kind: "reject_always" }
          ]
        }
      });
    }

    setTimeout(() => {
      send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
    }, 10);
    return;
  }

  if (msg.method === "session/cancel") {
    log({ cancel: msg });
  }
});
`);
  return { script, logPath, env: { MOCK_ACP_MODE: mode, MOCK_ACP_LOG: logPath } };
}

function readWire(logPath: string): any[] {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor timeout");
}

async function startProcess(options: SpawnOptions, mode = "") {
  const mock = writeMockAgent(mode);
  mockAgentPath = mock.script;
  const proc = new TestAcpProcess({
    cwd: process.cwd(),
    ...options,
    env: { ...(options.env ?? {}), ...mock.env },
  });
  processes.push(proc);
  await waitFor(() => proc.sessionId === "acp-session-1");
  return { proc, logPath: mock.logPath };
}

afterEach(() => {
  for (const proc of processes.splice(0)) proc.kill();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ACP shared adapter base", () => {
  it("serializes canonical history into a text transcript and skips status/noisy blocks", () => {
    const text = serializeHistoryForAcp([
      { actor: "user", kind: "text", content: "hello" },
      { actor: "assistant", kind: "thinking", content: "private" },
      { actor: "assistant", kind: "tool_use", content: "Read", meta: { name: "Read" } },
      { actor: "system", kind: "tool_result", content: "file contents" },
      { actor: "system", kind: "status", content: "complete" },
    ]);

    assert.equal(text, [
      "USER: hello",
      "ASSISTANT (calling Read): Read",
      "TOOL_RESULT: file contents",
    ].join("\n"));
  });

  it("combines systemPrompt and appendSystemPrompt with a blank line", () => {
    assert.equal(buildSystemPromptText("base", "append"), "base\n\nappend");
    assert.equal(buildSystemPromptText("base", undefined), "base");
    assert.equal(buildSystemPromptText(undefined, "append"), "append");
    assert.equal(buildSystemPromptText(" ", ""), null);
  });

  it("prepends system prompt and history resources only on the first prompt", async () => {
    const { proc, logPath } = await startProcess({
      cwd: process.cwd(),
      systemPrompt: "You are SNA.",
      appendSystemPrompt: "Be concise.",
      history: [{ actor: "user", kind: "text", content: "previous turn" }],
    });

    proc.send("current turn");
    await waitFor(() => readWire(logPath).filter((e) => e.in?.method === "session/prompt").length === 1);
    proc.send("second turn");
    await waitFor(() => readWire(logPath).filter((e) => e.in?.method === "session/prompt").length === 2);

    const prompts = readWire(logPath).filter((e) => e.in?.method === "session/prompt").map((e) => e.in.params.prompt);
    assert.equal(prompts[0].length, 3);
    assert.equal(prompts[0][0].resource.uri, "sna://system-prompt.txt");
    assert.equal(prompts[0][0].resource.text, "You are SNA.\n\nBe concise.");
    assert.equal(prompts[0][1].resource.uri, "sna://prior-conversation.txt");
    assert.match(prompts[0][1].resource.text, /USER: previous turn/);
    assert.deepEqual(prompts[0][2], { type: "text", text: "current turn" });
    assert.deepEqual(prompts[1], [{ type: "text", text: "second turn" }]);
  });

  it("normalizes ACP message, thought, tool, and completion updates", async () => {
    const { proc } = await startProcess({ cwd: process.cwd() }, "updates");
    const events: AgentEvent[] = [];
    proc.on("event", (event) => events.push(event));

    proc.send("run updates");
    await waitFor(() => events.some((event) => event.type === "complete"));

    assert.ok(events.some((event) => event.type === "thinking_delta" && event.delta === "plan"));
    assert.deepEqual(
      events.filter((event) => event.type === "assistant_delta").map((event) => event.delta),
      ["Hel", "lo"],
    );
    assert.ok(events.some((event) => event.type === "assistant" && event.message === "Hello"));
    assert.ok(events.some((event) => event.type === "tool_use" && event.data?.toolName === "Read" && event.data?.input && !(event.data as any).fromUpdate));
    assert.ok(events.some((event) => event.type === "tool_use" && event.data?.toolName === "Read" && (event.data as any).fromUpdate === true));
    assert.ok(events.some((event) => event.type === "tool_result" && event.data?.status === "completed" && event.data?.rawOutput === "ok"));
    assert.ok(events.some((event) => event.type === "complete" && event.data?.stopReason === "end_turn"));
  });

  it("emits permission_needed and responds with the selected ACP outcome", async () => {
    const { proc, logPath } = await startProcess({ cwd: process.cwd() }, "permission");
    const events: AgentEvent[] = [];
    proc.on("event", (event) => events.push(event));

    proc.send("needs approval");
    await waitFor(() => events.some((event) => event.type === "permission_needed"));
    proc.respondToPermission("perm-1", true);
    await waitFor(() => readWire(logPath).some((entry) => entry.response?.id === 100));

    const request = events.find((event) => event.type === "permission_needed");
    assert.equal(request?.data?.requestId, "perm-1");
    const response = readWire(logPath).find((entry) => entry.response?.id === 100).response;
    assert.deepEqual(response.result, { outcome: { outcome: "selected", optionId: "allow-once" } });
  });

  it("auto-approves ACP permission requests in bypassPermissions mode without emitting permission_needed", async () => {
    const { proc, logPath } = await startProcess({ cwd: process.cwd(), permissionMode: "bypassPermissions" }, "permission");
    const events: AgentEvent[] = [];
    proc.on("event", (event) => events.push(event));

    proc.send("auto approve");
    await waitFor(() => readWire(logPath).some((entry) => entry.response?.id === 100));

    assert.equal(events.some((event) => event.type === "permission_needed"), false);
    const response = readWire(logPath).find((entry) => entry.response?.id === 100).response;
    assert.deepEqual(response.result, { outcome: { outcome: "selected", optionId: "allow-always" } });
  });

  it("auto-rejects disallowed ACP tools before surfacing a permission prompt", async () => {
    const { proc, logPath } = await startProcess({ cwd: process.cwd(), disallowedTools: ["Bash"] }, "permission");
    const events: AgentEvent[] = [];
    proc.on("event", (event) => events.push(event));

    proc.send("blocked");
    await waitFor(() => readWire(logPath).some((entry) => entry.response?.id === 100));

    assert.equal(events.some((event) => event.type === "permission_needed"), false);
    const response = readWire(logPath).find((entry) => entry.response?.id === 100).response;
    assert.deepEqual(response.result, { outcome: { outcome: "selected", optionId: "reject-always" } });
  });
});
