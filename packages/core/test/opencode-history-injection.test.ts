/**
 * OpenCodeProvider integration tests against a mock OpenCode HTTP server.
 *
 * Uses the `providerOptions.serverUrl` short-circuit so prepareRuntime
 * routes to the mock instead of spawning the real `opencode serve` binary.
 * The unit under test is the path from canonical history → first prompt
 * `parts` body, plus the SSE → AgentEvent normalization for an end-to-end
 * "send hello, get back assistant_delta + assistant + complete" cycle.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenCodeProvider } from "../src/core/providers/opencode.js";
import type { AgentEvent } from "../src/core/providers/types.js";
import type { CanonicalBlock } from "../src/history/types.js";
import { startMockOpenCodeServer, type MockOpenCodeServer } from "./mock-opencode-server.js";

async function waitFor(fn: () => boolean, timeoutMs = 3000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function collectEvents(proc: { on: (ev: string, cb: (e: AgentEvent) => void) => void }): AgentEvent[] {
  const events: AgentEvent[] = [];
  proc.on("event", (e) => events.push(e));
  return events;
}

describe("OpenCodeProvider end-to-end via mock server", () => {
  let mock: MockOpenCodeServer;
  const provider = new OpenCodeProvider();

  before(async () => { mock = await startMockOpenCodeServer(); });
  after(async () => { await mock.close(); });
  beforeEach(() => { mock.reset(); });

  it("creates a session, sends prompt, and emits init/assistant_delta/assistant/complete", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd(), prompt: "hi" }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }

    const types = events.map((e) => e.type);
    assert.ok(types.includes("init"), "init event should fire");
    assert.ok(types.includes("assistant_delta"), "assistant_delta should fire");
    assert.ok(types.includes("assistant"), "final assistant should fire");
    assert.ok(types.includes("complete"), "complete should fire");
    assert.deepEqual(
      events.filter((e) => e.type === "tool_use" || e.type === "tool_use_delta" || e.type === "tool_result"),
      [],
      "assistant-only OpenCode turns must not surface fake tool events",
    );

    // Init carries the OpenCode session id.
    const init = events.find((e) => e.type === "init")!;
    assert.equal(init.data?.provider, "opencode");
    assert.match(String(init.data?.sessionId), /mock-sess-/);

    // Assistant deltas in order: "Hello", " world".
    const deltas = events.filter((e) => e.type === "assistant_delta").map((e) => e.delta);
    assert.deepEqual(deltas, ["Hello", " world"]);

    // Final assistant carries full text.
    const finalAssistant = events.find((e) => e.type === "assistant")!;
    assert.equal(finalAssistant.message, "Hello world");

    // Mock saw exactly one prompt_async call.
    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    assert.equal(promptCalls.length, 1, "exactly one prompt_async should fire");
    const body = promptCalls[0].body as { parts: Array<{ type: string; text?: string }> };
    assert.equal(body.parts.length, 1);
    assert.equal(body.parts[0].type, "text");
    assert.equal(body.parts[0].text, "hi");
  });

  it("text-only history is prepended to the first prompt parts as a prelude TextPartInput", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "I'm Yoonsu." },
      { actor: "assistant", kind: "text", content: "Nice to meet you." },
    ];
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "what's my name?",
      history,
    }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    assert.equal(promptCalls.length, 1, "exactly one prompt_async should fire");
    const body = promptCalls[0].body as { parts: Array<{ type: string; text?: string }> };
    assert.equal(body.parts.length, 2, "prelude + user text → two parts");

    const prelude = body.parts[0];
    assert.equal(prelude.type, "text");
    assert.match(prelude.text!, /<conversation-history>/);
    assert.match(prelude.text!, /\*\*User:\*\* I'm Yoonsu\./);
    assert.match(prelude.text!, /\*\*Assistant:\*\* Nice to meet you\./);

    const userPart = body.parts[1];
    assert.equal(userPart.type, "text");
    assert.equal(userPart.text, "what's my name?");
  });

  it("prelude is sent only on the FIRST send — subsequent sends are pure user text", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "first" },
      { actor: "assistant", kind: "text", content: "ok" },
    ];
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "second",
      history,
    }, handle);
    const events = collectEvents(proc);

    // Wait for the first prompt to complete.
    await waitFor(() => events.filter((e) => e.type === "complete").length >= 1);

    // Send a second user message.
    proc.send("third");

    // Wait for the second complete.
    await waitFor(() => events.filter((e) => e.type === "complete").length >= 2);
    proc.kill();

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    assert.equal(promptCalls.length, 2, "exactly two prompt_async calls");

    const first = promptCalls[0].body as { parts: Array<{ type: string; text?: string }> };
    const second = promptCalls[1].body as { parts: Array<{ type: string; text?: string }> };

    // First call: prelude + user
    assert.equal(first.parts.length, 2);
    assert.match(first.parts[0].text!, /<conversation-history>/);
    assert.equal(first.parts[1].text, "second");

    // Second call: user only
    assert.equal(second.parts.length, 1);
    assert.equal(second.parts[0].text, "third");
    assert.doesNotMatch(second.parts[0].text!, /<conversation-history>/);
  });

  it("does NOT send a synthetic 'continue' turn when only history is given without a prompt", async () => {
    // Regression guard mirroring the Codex-side rule from
    // codex-history-injection.test.ts: history alone must not trigger a
    // prompt; the prelude waits for the user's first real input.
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "earlier" },
      { actor: "assistant", kind: "text", content: "earlier reply" },
    ];
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd(), history }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));
    // Allow a grace window for any stray prompt to arrive.
    await new Promise((r) => setTimeout(r, 80));
    proc.kill();

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    assert.equal(promptCalls.length, 0, "no prompt_async should fire without an explicit user prompt");
  });

  it("model is parsed and passed as { providerID, modelID } in the prompt body", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
      model: "anthropic/claude-sonnet-4-6",
    }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    const body = promptCalls[0].body as { model?: { providerID: string; modelID: string } };
    assert.deepEqual(body.model, { providerID: "anthropic", modelID: "claude-sonnet-4-6" });
  });

  it("uses providerOptions.modelProviderId as the provider half for bare OpenAI model slugs", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url, modelProviderId: "openai" },
    });
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
      model: "gpt-5.4",
      providerOptions: { modelProviderId: "openai" },
    }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    const body = promptCalls[0].body as { model?: { providerID: string; modelID: string } };
    assert.deepEqual(body.model, { providerID: "openai", modelID: "gpt-5.4" });
  });

  it("sends image ContentBlock input as an OpenCode file part", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    proc.send([
      { type: "text", text: "inspect this image" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
      },
    ]);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    const body = promptCalls[0].body as { parts: Array<{ type: string; text?: string; mime?: string; url?: string }> };
    assert.deepEqual(body.parts[0], { type: "text", text: "inspect this image" });
    assert.equal(body.parts[1].type, "file");
    assert.equal(body.parts[1].mime, "image/png");
    assert.equal(body.parts[1].url, "data:image/png;base64,iVBORw0KGgo=");
  });

  it("maps permissionMode=plan to body.agent=plan for the first prompt", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "plan it",
      permissionMode: "plan",
    }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    const body = promptCalls[0].body as { agent?: string };
    assert.equal(body.agent, "plan");
  });

  it("setModel applies a one-turn model override and then clears it", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    proc.setModel("openai/gpt-5.4");
    proc.send("first");
    await waitFor(() => events.filter((e) => e.type === "complete").length >= 1);
    proc.send("second");
    await waitFor(() => events.filter((e) => e.type === "complete").length >= 2);
    proc.kill();

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    assert.equal(promptCalls.length, 2);
    assert.deepEqual((promptCalls[0].body as any).model, { providerID: "openai", modelID: "gpt-5.4" });
    assert.equal((promptCalls[1].body as any).model, undefined);
  });

  it("setPermissionMode(plan) applies agent=plan to the next prompt only", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    proc.setPermissionMode("plan");
    proc.send("first");
    await waitFor(() => events.filter((e) => e.type === "complete").length >= 1);
    proc.send("second");
    await waitFor(() => events.filter((e) => e.type === "complete").length >= 2);
    proc.kill();

    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    assert.equal((promptCalls[0].body as any).agent, "plan");
    assert.equal((promptCalls[1].body as any).agent, undefined);
  });

  it("permission events propagate as permission_needed and respond via HTTP", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    // Inject a permission event into the SSE stream.
    mock.emit({
      type: "permission.updated",
      properties: {
        id: "perm-42",
        type: "shell",
        sessionID: proc.sessionId!,
        messageID: "m1",
        callID: "c1",
        title: "Run shell command",
        metadata: { command: "rm -rf /" },
        time: { created: Date.now() },
      },
    });

    await waitFor(() => events.some((e) => e.type === "permission_needed"));
    const permEv = events.find((e) => e.type === "permission_needed")!;
    assert.equal(permEv.data?.requestId, "perm-42");
    assert.equal(permEv.data?.toolName, "shell");

    // Respond.
    proc.respondToPermission!("perm-42", true);

    // Verify HTTP call was made.
    await waitFor(() => mock.requestsFor((r) =>
      r.method === "POST" && /\/permissions\/perm-42/.test(r.url),
    ).length > 0);

    const respCalls = mock.requestsFor((r) =>
      r.method === "POST" && /\/permissions\/perm-42/.test(r.url),
    );
    assert.equal(respCalls.length, 1);
    const body = respCalls[0].body as { response: string };
    assert.equal(body.response, "once");

    proc.kill();
  });

  it("bypassPermissions auto-approves permission events without emitting permission_needed", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd(), permissionMode: "bypassPermissions" }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    mock.emit({
      type: "permission.updated",
      properties: {
        id: "perm-auto",
        type: "shell",
        sessionID: proc.sessionId!,
        title: "Run command",
        metadata: { command: "echo ok" },
      },
    });

    await waitFor(() => mock.requestsFor((r) =>
      r.method === "POST" && /\/permissions\/perm-auto/.test(r.url),
    ).length > 0);

    assert.equal(events.some((e) => e.type === "permission_needed"), false);
    const body = mock.requestsFor((r) =>
      r.method === "POST" && /\/permissions\/perm-auto/.test(r.url),
    )[0].body as { response: string };
    assert.equal(body.response, "once");

    proc.kill();
  });

  it("session.error SSE events are normalized to AgentEvent error", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    mock.emit({
      type: "session.error",
      properties: {
        sessionID: proc.sessionId!,
        error: { name: "ProviderError", data: { message: "OpenAI rejected request" } },
      },
    });

    await waitFor(() => events.some((e) => e.type === "error"));
    const error = events.find((e) => e.type === "error")!;
    assert.equal(error.message, "OpenAI rejected request");

    proc.kill();
  });

  it("reasoning part deltas and final reasoning part become thinking events", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    mock.emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reason-1",
          sessionID: proc.sessionId!,
          messageID: "m-reason",
          type: "reasoning",
          text: "",
          time: { start: Date.now() },
        },
      },
    });
    mock.emit({
      type: "message.part.delta",
      properties: {
        sessionID: proc.sessionId!,
        messageID: "m-reason",
        partID: "reason-1",
        field: "reasoning",
        delta: "thinking...",
      },
    });
    mock.emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reason-1",
          sessionID: proc.sessionId!,
          messageID: "m-reason",
          type: "reasoning",
          text: "thinking...done",
          time: { start: Date.now() - 10, end: Date.now() },
        },
      },
    });

    await waitFor(() => events.some((e) => e.type === "thinking"));
    assert.equal(events.find((e) => e.type === "thinking_delta")?.message, "thinking...");
    assert.equal(events.find((e) => e.type === "thinking")?.message, "thinking...done");

    proc.kill();
  });

  it("tool part running/completed updates become tool_use and tool_result", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    mock.emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-1",
          sessionID: proc.sessionId!,
          messageID: "m-tool",
          type: "tool",
          tool: "bash",
          callID: "call-1",
          state: { status: "running", input: { command: "pwd" } },
        },
      },
    });
    mock.emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-1",
          sessionID: proc.sessionId!,
          messageID: "m-tool",
          type: "tool",
          tool: "bash",
          callID: "call-1",
          state: { status: "completed", output: "/repo", title: "pwd" },
        },
      },
    });

    await waitFor(() => events.some((e) => e.type === "tool_result"));
    const use = events.find((e) => e.type === "tool_use")!;
    const result = events.find((e) => e.type === "tool_result")!;
    assert.equal(use.message, "bash");
    assert.deepEqual(use.data?.input, { command: "pwd" });
    assert.equal(result.message, "/repo");
    assert.equal(result.data?.isError, false);

    proc.kill();
  });

  it("tool part error updates become error tool_result", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    mock.emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-err",
          sessionID: proc.sessionId!,
          messageID: "m-tool",
          type: "tool",
          tool: "bash",
          callID: "call-err",
          state: { status: "error", error: "permission denied" },
        },
      },
    });

    await waitFor(() => events.some((e) => e.type === "tool_result"));
    const result = events.find((e) => e.type === "tool_result")!;
    assert.equal(result.message, "permission denied");
    assert.equal(result.data?.toolName, "bash");
    assert.equal(result.data?.isError, true);

    proc.kill();
  });

  it("surfaces unknown OpenCode tool-like events as generic tool events", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    mock.emit({
      type: "experimental.tool.started",
      properties: {
        sessionID: proc.sessionId!,
        id: "unknown-tool-1",
        toolName: "web_search",
        input: { query: "SNA" },
        status: "running",
      },
    });
    mock.emit({
      type: "experimental.tool.input_delta",
      properties: {
        sessionID: proc.sessionId!,
        id: "unknown-tool-1",
        toolName: "web_search",
        delta: "{\"query\"",
      },
    });
    mock.emit({
      type: "experimental.tool.finished",
      properties: {
        sessionID: proc.sessionId!,
        id: "unknown-tool-1",
        toolName: "web_search",
        output: "2 results",
        status: "completed",
      },
    });

    await waitFor(() => events.some((e) => e.type === "tool_result"));
    const use = events.find((e) => e.type === "tool_use")!;
    const result = events.find((e) => e.type === "tool_result")!;
    assert.equal(use.data?.id, "unknown-tool-1");
    assert.equal(use.data?.toolName, "web_search");
    assert.deepEqual(use.data?.input, { query: "SNA" });
    assert.equal(use.data?.rawEventType, "experimental.tool.started");
    assert.equal(events.find((e) => e.type === "tool_use_delta")?.delta, "{\"query\"");
    assert.equal(result.data?.id, "unknown-tool-1");
    assert.equal(result.data?.toolName, "web_search");
    assert.equal(result.message, "2 results");
    assert.equal(result.data?.rawEventType, "experimental.tool.finished");

    proc.kill();
  });

  it("interrupt() calls /abort and emits 'interrupted'", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd() }, handle);
    const events = collectEvents(proc);
    await waitFor(() => events.some((e) => e.type === "init"));

    proc.interrupt();
    await waitFor(() => events.some((e) => e.type === "interrupted"));

    const aborts = mock.requestsFor((r) => r.method === "POST" && /\/abort/.test(r.url));
    assert.equal(aborts.length, 1);

    proc.kill();
  });

  it("forwards systemPrompt + appendSystemPrompt as body.system on every prompt", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
      systemPrompt: "You are Loom Coder.",
      appendSystemPrompt: "Follow tag protocol.",
    }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }
    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    assert.equal(promptCalls.length, 1);
    const body = promptCalls[0].body as { system?: string };
    assert.equal(body.system, "You are Loom Coder.\n\nFollow tag protocol.");
  });

  it("forwards disallowedTools as body.tools={name:false,...}", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
      disallowedTools: ["Bash", "Read", "Write"],
    }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }
    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    const body = promptCalls[0].body as { tools?: Record<string, boolean> };
    assert.deepEqual(body.tools, { Bash: false, Read: false, Write: false });
  });

  it("does not include body.tools when neither allow nor disallow is set", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc = provider.spawn({ cwd: process.cwd(), prompt: "hi" }, handle);
    const events = collectEvents(proc);
    try {
      await waitFor(() => events.some((e) => e.type === "complete"));
    } finally {
      proc.kill();
    }
    const promptCalls = mock.requestsFor((r) => r.method === "POST" && /\/prompt_async/.test(r.url));
    const body = promptCalls[0].body as { tools?: Record<string, boolean> };
    assert.equal(body.tools, undefined);
  });

  it("kill() decrements activeThreadCount on the runtime handle (pooling discipline)", async () => {
    const handle = await provider.prepareRuntime({
      provider: "opencode",
      cwd: process.cwd(),
      providerOptions: { serverUrl: mock.url },
    });
    const proc1 = provider.spawn({ cwd: process.cwd() }, handle);
    const proc2 = provider.spawn({ cwd: process.cwd() }, handle);
    assert.equal(handle.activeThreadCount, 2);
    proc1.kill();
    assert.equal(handle.activeThreadCount, 1);
    proc2.kill();
    assert.equal(handle.activeThreadCount, 0);
  });
});
