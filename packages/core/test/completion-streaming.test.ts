/**
 * Unit tests for the streaming-completion onDelta wiring.
 *
 * These tests cover the per-line JSONL extractors — the small pieces of
 * logic that decide whether a given provider stdout line carries an
 * assistant-text delta worth forwarding to the consumer's callback.
 *
 * Full end-to-end coverage (pool path + ephemeral spawn path) would
 * require a streaming-aware mock; here we lock in the extraction shapes
 * so they don't regress when the provider stream formats churn.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractCodexExecDelta } from "../src/core/providers/codex.js";
import { extractClaudeStreamDelta } from "../src/core/providers/claude-code.js";

describe("extractCodexExecDelta", () => {
  it("returns the delta text from agent_message.delta events", () => {
    const evt = { type: "agent_message.delta", delta: "Hello" };
    assert.equal(extractCodexExecDelta(evt), "Hello");
  });

  it("returns the delta text from item.updated agent_message events", () => {
    const evt = {
      type: "item.updated",
      item: { type: "agent_message", id: "msg_1", delta: " world" },
    };
    assert.equal(extractCodexExecDelta(evt), " world");
  });

  it("supports the alternate item.updated shape with top-level delta", () => {
    const evt = {
      type: "item.updated",
      item: { type: "agent_message", id: "msg_1" },
      delta: " punctuation",
    };
    assert.equal(extractCodexExecDelta(evt), " punctuation");
  });

  it("returns null for turn lifecycle events", () => {
    assert.equal(extractCodexExecDelta({ type: "turn.started" }), null);
    assert.equal(
      extractCodexExecDelta({
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 },
      }),
      null,
    );
  });

  it("returns null for non-agent-message item.updated events", () => {
    const evt = {
      type: "item.updated",
      item: { type: "tool_call", id: "t_1", delta: "..." },
    };
    assert.equal(extractCodexExecDelta(evt), null);
  });

  it("ignores final item.completed text to avoid double emission", () => {
    const evt = {
      type: "item.completed",
      item: { type: "agent_message", id: "msg_1", text: "Hello world" },
    };
    assert.equal(extractCodexExecDelta(evt), null);
  });

  it("returns null for malformed input", () => {
    assert.equal(extractCodexExecDelta(null), null);
    assert.equal(extractCodexExecDelta(undefined), null);
    assert.equal(extractCodexExecDelta("not an object"), null);
    assert.equal(extractCodexExecDelta({}), null);
  });
});

describe("extractClaudeStreamDelta", () => {
  it("returns the delta text from a content_block_delta text_delta", () => {
    const evt = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      },
    };
    assert.equal(extractClaudeStreamDelta(evt), "Hi");
  });

  it("returns null for thinking_delta events", () => {
    const evt = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "let me check" },
      },
    };
    assert.equal(extractClaudeStreamDelta(evt), null);
  });

  it("returns null for input_json_delta events", () => {
    const evt = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{}" },
      },
    };
    assert.equal(extractClaudeStreamDelta(evt), null);
  });

  it("returns null for non-stream_event messages", () => {
    assert.equal(
      extractClaudeStreamDelta({ type: "assistant", message: { content: [] } }),
      null,
    );
    assert.equal(
      extractClaudeStreamDelta({ type: "result", subtype: "success" }),
      null,
    );
  });

  it("returns null for empty-text deltas (start of block heartbeat)", () => {
    const evt = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "" },
      },
    };
    assert.equal(extractClaudeStreamDelta(evt), null);
  });

  it("returns null for malformed input", () => {
    assert.equal(extractClaudeStreamDelta(null), null);
    assert.equal(extractClaudeStreamDelta(undefined), null);
    assert.equal(extractClaudeStreamDelta({}), null);
  });
});
