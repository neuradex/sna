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
