/**
 * ClaudeCodeProcess — verify that `input_json_delta` content_block deltas are
 * forwarded as `tool_use_delta` AgentEvents.
 *
 * Why: Anthropic streams partial JSON for tool inputs character-by-character.
 * Generative-UI streaming (artifact / collaborative document patches over an
 * MCP tool) depends on these deltas reaching the UI before the tool call
 * completes. Prior to this branch, the provider dropped them — the SDK only
 * surfaced the start signal (`input: null`) and the final completed input.
 *
 * Fixture is captured from a real Claude Code run (see
 * `fixtures/cc-input-json-delta.jsonl`) so this also serves as a regression
 * lock against upstream wire-format drift.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { ClaudeCodeProcess } from "../src/core/providers/claude-code.js";
import type { AgentEvent, SpawnOptions } from "../src/core/providers/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "cc-input-json-delta.jsonl");

/** Minimal ChildProcess stub — only the surface ClaudeCodeProcess touches in its constructor. */
function makeMockProc(): { proc: ChildProcess; pushLine: (line: string) => void; close: () => void } {
  const stdout = new Readable({ read() { /* no-op, we push manually */ } });
  const stderr = new Readable({ read() { /* no-op */ } });
  const stdin = { write: () => true, end: () => {} };
  const proc = new EventEmitter() as unknown as ChildProcess;
  Object.defineProperty(proc, "stdout", { value: stdout });
  Object.defineProperty(proc, "stderr", { value: stderr });
  Object.defineProperty(proc, "stdin", { value: stdin });
  Object.defineProperty(proc, "pid", { value: 99999 });
  (proc as unknown as { kill: () => void }).kill = () => {};

  return {
    proc,
    pushLine: (line: string) => stdout.push(`${line}\n`),
    close: () => {
      stdout.push(null);
      proc.emit("exit", 0);
    },
  };
}

const SPAWN_OPTIONS: SpawnOptions = { cwd: "/tmp/test-cc-fixture" };

describe("ClaudeCodeProcess — tool_use_delta forwarding", () => {
  it("emits tool_use_delta for each input_json_delta in the captured fixture", async () => {
    const { proc, pushLine, close } = makeMockProc();
    const cc = new ClaudeCodeProcess(proc, SPAWN_OPTIONS);

    const events: AgentEvent[] = [];
    cc.on("event", (e) => events.push(e));

    const lines = fs.readFileSync(FIXTURE_PATH, "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines) pushLine(line);

    await new Promise<void>((resolve) => {
      cc.on("exit", () => resolve());
      close();
    });
    // Drain queue (timer-based, 15ms per event — fixture has ~5 events so 200ms is safe)
    await new Promise((r) => setTimeout(r, 250));

    const toolUseDeltas = events.filter((e) => e.type === "tool_use_delta");
    assert.equal(toolUseDeltas.length, 3, "expected 3 input_json_delta forwards from fixture");

    // Each carries the tool_use id captured from the matching content_block_start.
    for (const e of toolUseDeltas) {
      assert.equal(
        (e.data as { id?: string }).id,
        "toolu_01NmocvitD3eEQe6T98Q379P",
        "tool_use_delta must carry the id from the matching content_block_start",
      );
      assert.equal(e.index, 1);
    }

    // Concatenated partial_json must reconstruct the complete input.
    const reconstructed = toolUseDeltas.map((e) => e.delta ?? "").join("");
    assert.deepEqual(JSON.parse(reconstructed), { file_path: "/private/tmp/cc-verify-cwd/sample.txt" });

    // tool_use start signal still arrives (with input: null) — generative-UI
    // consumers use it to mount the streaming bubble before deltas arrive.
    const toolUseStart = events.find(
      (e) => e.type === "tool_use" && (e.data as { streaming?: boolean }).streaming === true,
    );
    assert.ok(toolUseStart, "expected an initial tool_use event with streaming: true");
    assert.equal((toolUseStart!.data as { id?: string }).id, "toolu_01NmocvitD3eEQe6T98Q379P");
  });

  it("ignores input_json_delta with no preceding content_block_start (defensive — id is undefined)", async () => {
    const { proc, pushLine, close } = makeMockProc();
    const cc = new ClaudeCodeProcess(proc, SPAWN_OPTIONS);

    const events: AgentEvent[] = [];
    cc.on("event", (e) => events.push(e));

    // Synthetic — delta arrives with no matching start. Provider should still
    // emit the event (for resilience) but data.id is undefined.
    pushLine(JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 7, delta: { type: "input_json_delta", partial_json: "{\"k\":1}" } },
    }));

    await new Promise<void>((resolve) => {
      cc.on("exit", () => resolve());
      close();
    });
    await new Promise((r) => setTimeout(r, 100));

    const tud = events.find((e) => e.type === "tool_use_delta");
    assert.ok(tud, "delta is forwarded even without a matching start");
    assert.equal((tud!.data as { id?: string }).id, undefined);
    assert.equal(tud!.delta, "{\"k\":1}");
  });

  it("emits the completed tool input only after all queued input_json_delta chunks", async () => {
    const { proc, pushLine, close } = makeMockProc();
    const cc = new ClaudeCodeProcess(proc, SPAWN_OPTIONS);

    const events: AgentEvent[] = [];
    cc.on("event", (e) => events.push(e));

    const toolUseId = "toolu_ordered_input";
    pushLine(JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: toolUseId, name: "Write", input: {}, caller: { type: "direct" } },
      },
    }));
    pushLine(JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"body\":\"Hel" } },
    }));
    pushLine(JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "lo\"}" } },
    }));
    pushLine(JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: toolUseId, name: "Write", input: { body: "Hello" }, caller: { type: "direct" } },
        ],
        stop_reason: null,
      },
    }));

    await new Promise<void>((resolve) => {
      cc.on("exit", () => resolve());
      close();
    });
    await new Promise((r) => setTimeout(r, 50));

    const ordered = events
      .filter((e) => e.type === "tool_use_delta" || (e.type === "tool_use" && (e.data as { id?: string }).id === toolUseId))
      .map((e) => e.type === "tool_use_delta"
        ? `delta:${e.delta}`
        : (e.data as { update?: boolean }).update
          ? "update"
          : "start");

    assert.deepEqual(ordered, [
      "start",
      "delta:{\"body\":\"Hel",
      "delta:lo\"}",
      "update",
    ]);
  });
});
