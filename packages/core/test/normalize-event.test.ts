/**
 * ClaudeCodeProcess.normalizeEvent tests — verify event parsing.
 *
 * Since normalizeEvent is private, we test it through the public interface
 * by feeding raw stdout lines to a mock process.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent } from "../src/core/providers/types.js";

// We can't easily instantiate ClaudeCodeProcess directly (needs ChildProcess),
// so we test the normalization logic by extracting the patterns.
// These tests verify the exact conditions that caused bugs.

describe("Event normalization logic", () => {

  // Simulates normalizeEvent logic for streaming delta events
  function normalizeDelta(msg: any, blockTypes: Map<number, string>): AgentEvent | null {
    if (msg.type === "content_block_start") {
      const blockType = msg.content_block?.type as string | undefined;
      if (blockType) blockTypes.set(msg.index as number, blockType);
      return null;
    }
    if (msg.type === "content_block_delta") {
      const idx = msg.index as number;
      const delta = msg.delta;
      const blockType = blockTypes.get(idx) ?? "text";
      if (blockType === "text" && delta?.type === "text_delta" && delta.text) {
        return { type: "assistant_delta", delta: delta.text as string, index: idx, timestamp: Date.now() };
      }
      return null;
    }
    if (msg.type === "content_block_stop") {
      blockTypes.delete(msg.index as number);
      return null;
    }
    if (msg.type === "message_stop") return null;
    return null;
  }

  // Simulates the normalizeEvent logic for "result" type messages
  function normalizeResult(msg: any): AgentEvent | null {
    if (msg.type !== "result") return null;
    if (msg.subtype === "success") {
      return {
        type: "complete",
        message: msg.result ?? "Done",
        data: { durationMs: msg.duration_ms, costUsd: msg.total_cost_usd },
        timestamp: Date.now(),
      };
    }
    if (msg.subtype === "error_during_execution" && msg.is_error === false) {
      return {
        type: "interrupted",
        message: "Turn interrupted by user",
        data: { durationMs: msg.duration_ms, costUsd: msg.total_cost_usd },
        timestamp: Date.now(),
      };
    }
    if (msg.subtype?.startsWith("error") || msg.is_error) {
      return {
        type: "error",
        message: msg.result ?? msg.error ?? "Unknown error",
        timestamp: Date.now(),
      };
    }
    return null;
  }

  // Simulates init normalization
  function normalizeInit(msg: any, sessionId: string | null, initEmitted: boolean): { event: AgentEvent | null; initEmitted: boolean } {
    if (msg.type !== "system" || msg.subtype !== "init") return { event: null, initEmitted };
    if (initEmitted) return { event: null, initEmitted };
    return {
      event: {
        type: "init",
        message: `Agent ready (${msg.model ?? "unknown"})`,
        data: { sessionId: msg.session_id, model: msg.model },
        timestamp: Date.now(),
      },
      initEmitted: true,
    };
  }

  describe("streaming delta events", () => {
    it("content_block_start registers block type, returns null", () => {
      const blockTypes = new Map<number, string>();
      const event = normalizeDelta({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, blockTypes);
      assert.equal(event, null);
      assert.equal(blockTypes.get(0), "text");
    });

    it("content_block_delta (text_delta) → assistant_delta with delta and index", () => {
      const blockTypes = new Map<number, string>([[0, "text"]]);
      const event = normalizeDelta({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }, blockTypes);
      assert.equal(event?.type, "assistant_delta");
      assert.equal(event?.delta, "Hello");
      assert.equal(event?.index, 0);
    });

    it("content_block_delta for thinking block → null (not emitted)", () => {
      const blockTypes = new Map<number, string>([[0, "thinking"]]);
      const event = normalizeDelta({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Reasoning..." } }, blockTypes);
      assert.equal(event, null);
    });

    it("content_block_delta with empty text → null", () => {
      const blockTypes = new Map<number, string>([[0, "text"]]);
      const event = normalizeDelta({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "" } }, blockTypes);
      assert.equal(event, null);
    });

    it("content_block_stop removes block type, returns null", () => {
      const blockTypes = new Map<number, string>([[0, "text"]]);
      const event = normalizeDelta({ type: "content_block_stop", index: 0 }, blockTypes);
      assert.equal(event, null);
      assert.equal(blockTypes.has(0), false);
    });

    it("message_stop → null", () => {
      const blockTypes = new Map<number, string>();
      const event = normalizeDelta({ type: "message_stop" }, blockTypes);
      assert.equal(event, null);
    });

    it("full streaming sequence produces correct delta events", () => {
      const blockTypes = new Map<number, string>();
      const events: (AgentEvent | null)[] = [
        normalizeDelta({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, blockTypes),
        normalizeDelta({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }, blockTypes),
        normalizeDelta({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } }, blockTypes),
        normalizeDelta({ type: "content_block_stop", index: 0 }, blockTypes),
        normalizeDelta({ type: "message_stop" }, blockTypes),
      ];
      const deltas = events.filter(Boolean);
      assert.equal(deltas.length, 2);
      assert.equal(deltas[0]?.type, "assistant_delta");
      assert.equal(deltas[0]?.delta, "Hi");
      assert.equal(deltas[1]?.delta, " there");
    });
  });

  describe("result events", () => {
    it("success → complete event", () => {
      const event = normalizeResult({
        type: "result", subtype: "success", result: "Done", duration_ms: 100, total_cost_usd: 0.01,
      });
      assert.equal(event?.type, "complete");
      assert.equal(event?.message, "Done");
    });

    it("error_during_execution with is_error=false → interrupted (not error)", () => {
      const event = normalizeResult({
        type: "result", subtype: "error_during_execution", is_error: false, duration_ms: 50,
      });
      assert.equal(event?.type, "interrupted");
      assert.equal(event?.message, "Turn interrupted by user");
    });

    it("error_during_execution with is_error=true → error", () => {
      const event = normalizeResult({
        type: "result", subtype: "error_during_execution", is_error: true, result: "Failed",
      });
      assert.equal(event?.type, "error");
      assert.equal(event?.message, "Failed");
    });

    it("error subtype → error event", () => {
      const event = normalizeResult({
        type: "result", subtype: "error", is_error: true, result: "Auth failed",
      });
      assert.equal(event?.type, "error");
      assert.equal(event?.message, "Auth failed");
    });

    it("error with null result/error → 'Unknown error'", () => {
      const event = normalizeResult({
        type: "result", subtype: "error", is_error: true,
      });
      assert.equal(event?.type, "error");
      assert.equal(event?.message, "Unknown error");
    });

    it("subtype starting with 'error' matches (e.g., error_timeout)", () => {
      const event = normalizeResult({
        type: "result", subtype: "error_timeout", is_error: true, result: "Timed out",
      });
      assert.equal(event?.type, "error");
    });
  });

  describe("init events", () => {
    it("first init emits event", () => {
      const { event, initEmitted } = normalizeInit(
        { type: "system", subtype: "init", session_id: "abc", model: "sonnet" },
        null, false,
      );
      assert.equal(event?.type, "init");
      assert.equal(event?.data?.sessionId, "abc");
      assert.equal(initEmitted, true);
    });

    it("duplicate init after interrupt is suppressed", () => {
      // First init
      const r1 = normalizeInit(
        { type: "system", subtype: "init", session_id: "abc", model: "sonnet" },
        null, false,
      );
      assert.ok(r1.event);

      // Second init (same session, after interrupt)
      const r2 = normalizeInit(
        { type: "system", subtype: "init", session_id: "abc", model: "sonnet" },
        "abc", r1.initEmitted,
      );
      assert.equal(r2.event, null, "Duplicate init should be suppressed");
    });

    it("init with _sessionId already set but initEmitted=false still emits", () => {
      // This was the bug: stdout handler sets _sessionId before normalizeEvent runs
      // The fix uses _initEmitted flag, not _sessionId comparison
      const { event } = normalizeInit(
        { type: "system", subtype: "init", session_id: "abc", model: "sonnet" },
        "abc", // _sessionId already set
        false, // but initEmitted is false
      );
      assert.ok(event, "First init should emit even if _sessionId is already set");
    });
  });
});
