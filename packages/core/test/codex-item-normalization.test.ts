/**
 * Verifies how CodexProcess normalizes turn-level item events.
 *
 * The interesting cases are the ones that *weren't* surfaced before:
 *   - image_generation gets its own shape (toolName, savedPath, revisedPrompt)
 *   - unknown item types are forwarded as generic tool_use/tool_result with
 *     `data.raw` (fail-open), instead of silently dropped (fail-closed).
 *   - tool_result events carry `durationMs` derived from the item/started
 *     → item/completed delta, so consumers can show "this took N seconds"
 *     for hosted tools that have no intermediate progress signal.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CodexProvider } from "../src/core/providers/codex.js";
import type { AgentEvent } from "../src/core/providers/types.js";
import { startMockCodexAppServer, type MockCodexServer } from "./mock-codex-app-server.js";

async function waitFor(fn: () => boolean, timeoutMs = 2500, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("CodexProcess — item normalization", () => {
  let mock: MockCodexServer;
  const origCodexCmd = process.env.SNA_CODEX_COMMAND;
  const origTurnNotifications = process.env.CODEX_MOCK_TURN_NOTIFICATIONS;

  before(() => {
    mock = startMockCodexAppServer();
    process.env.SNA_CODEX_COMMAND = mock.command;
  });

  after(() => {
    if (origCodexCmd === undefined) delete process.env.SNA_CODEX_COMMAND;
    else process.env.SNA_CODEX_COMMAND = origCodexCmd;
    if (origTurnNotifications === undefined) delete process.env.CODEX_MOCK_TURN_NOTIFICATIONS;
    else process.env.CODEX_MOCK_TURN_NOTIFICATIONS = origTurnNotifications;
    mock.close();
  });

  beforeEach(() => {
    mock.reset();
    delete process.env.CODEX_MOCK_TURN_NOTIFICATIONS;
  });

  it("does not treat agentMessage starts as tool_use while preserving assistant deltas and completion", async () => {
    process.env.CODEX_MOCK_TURN_NOTIFICATIONS = JSON.stringify([
      {
        jsonrpc: "2.0",
        method: "item/started",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_1",
            status: "in_progress",
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "item/agentMessage/delta",
        params: {
          itemId: "msg_1",
          delta: "Hello ",
        },
      },
      {
        jsonrpc: "2.0",
        method: "item/agentMessage/delta",
        params: {
          itemId: "msg_1",
          delta: "world",
        },
      },
      {
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg_1",
            status: "completed",
            text: "Hello world",
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "thread/status/changed",
        params: { status: "idle" },
      },
    ]);

    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), prompt: "say hello" });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    assert.equal(
      events.some((e) => e.type === "tool_use" && (e.data as any)?.toolName === "agentMessage"),
      false,
      "agentMessage item/started must not surface as a fake tool_use",
    );
    assert.equal(
      events.some((e) => e.type === "tool_result" && (e.data as any)?.toolName === "agentMessage"),
      false,
      "assistant messages should not require a matching tool_result",
    );

    const deltas = events.filter((e) => e.type === "assistant_delta").map((e) => e.delta).join("");
    assert.equal(deltas, "Hello world");

    const assistant = events.find((e) => e.type === "assistant");
    assert.equal(assistant?.message, "Hello world");
    assert.ok(events.some((e) => e.type === "complete"), "turn should still complete");
  });

  it("forwards image_generation lifecycle as tool_use (start) + tool_result (savedPath + revisedPrompt + duration)", async () => {
    process.env.CODEX_MOCK_TURN_NOTIFICATIONS = JSON.stringify([
      {
        jsonrpc: "2.0",
        method: "item/started",
        params: {
          item: {
            type: "image_generation",
            id: "ig_42",
            status: "in_progress",
          },
        },
      },
      // brief pause so duration is non-zero in the test
      // (the mock writes events synchronously, but Date.now ticks ms)
      {
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          item: {
            type: "image_generation",
            id: "ig_42",
            status: "completed",
            revised_prompt: "A watercolor of a cat hugging an otter",
            saved_path: "/tmp/codex_home/sess1/ig_42.png",
          },
        },
      },
    ]);

    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), prompt: "draw me a cat" });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const toolUses = events.filter(
      (e) => e.type === "tool_use" && (e.data as any)?.toolName === "image_generation",
    );
    const toolResults = events.filter(
      (e) => e.type === "tool_result" && (e.data as any)?.toolName === "image_generation",
    );

    assert.equal(toolUses.length, 1, "exactly one image_generation tool_use (the start)");
    assert.equal((toolUses[0]?.data as any)?.streaming, true);
    assert.equal((toolUses[0]?.data as any)?.id, "ig_42");

    assert.equal(toolResults.length, 1);
    const completed = toolResults[0]!;
    assert.equal((completed.data as any).savedPath, "/tmp/codex_home/sess1/ig_42.png");
    assert.equal((completed.data as any).revisedPrompt, "A watercolor of a cat hugging an otter");
    assert.equal((completed.data as any).status, "completed");
    assert.equal((completed.data as any).isError, false);
    assert.equal(typeof (completed.data as any).durationMs, "number");
    assert.ok((completed.data as any).durationMs >= 0);
  });

  it("forwards unknown item types as generic tool_use / tool_result with raw payload (fail-open)", async () => {
    process.env.CODEX_MOCK_TURN_NOTIFICATIONS = JSON.stringify([
      {
        jsonrpc: "2.0",
        method: "item/started",
        params: {
          item: {
            type: "future_widget",
            id: "fw_7",
            status: "in_progress",
            custom_field: "hello",
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          item: {
            type: "future_widget",
            id: "fw_7",
            status: "completed",
            custom_field: "hello",
            result_value: 42,
          },
        },
      },
    ]);

    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), prompt: "do the future widget thing" });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const toolUses = events.filter(
      (e) => e.type === "tool_use" && (e.data as any)?.toolName === "future_widget",
    );
    const toolResults = events.filter(
      (e) => e.type === "tool_result" && (e.data as any)?.toolName === "future_widget",
    );

    assert.equal(toolUses.length, 1, "unknown item.type should still produce a tool_use");
    assert.equal((toolUses[0]?.data as any)?.id, "fw_7");
    assert.equal((toolUses[0]?.data as any)?.streaming, true);
    // Raw payload is attached so consumers can introspect.
    assert.equal((toolUses[0]?.data as any)?.raw?.custom_field, "hello");

    assert.equal(toolResults.length, 1);
    const completed = toolResults[0]!;
    assert.equal((completed.data as any).id, "fw_7");
    assert.equal((completed.data as any).status, "completed");
    assert.equal((completed.data as any).isError, false);
    assert.equal((completed.data as any).raw?.result_value, 42);
    assert.equal(typeof (completed.data as any).durationMs, "number");
  });

  it("marks unknown items as isError when status is 'failed'", async () => {
    process.env.CODEX_MOCK_TURN_NOTIFICATIONS = JSON.stringify([
      {
        jsonrpc: "2.0",
        method: "item/started",
        params: { item: { type: "future_widget", id: "fw_8", status: "in_progress" } },
      },
      {
        jsonrpc: "2.0",
        method: "item/completed",
        params: { item: { type: "future_widget", id: "fw_8", status: "failed" } },
      },
    ]);

    const provider = new CodexProvider();
    const proc = provider.spawn({ cwd: process.cwd(), prompt: "fail it" });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const result = events.find(
      (e) => e.type === "tool_result" && (e.data as any)?.toolName === "future_widget",
    );
    assert.ok(result, "fail-open default should still emit a tool_result");
    assert.equal((result!.data as any).isError, true);
    assert.equal((result!.data as any).status, "failed");
  });
});
