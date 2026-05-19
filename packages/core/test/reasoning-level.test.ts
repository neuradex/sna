/**
 * Unit tests for the reasoning-level translation table.
 * Locks the mapping so accidental edits to reasoning-level.ts surface here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toClaudeEffort,
  toCodexEffort,
  type ReasoningLevel,
} from "../src/core/providers/reasoning-level.js";

describe("reasoning-level translation", () => {
  it("maps 0..5 to Claude Code --effort values (low/low/medium/high/xhigh/max)", () => {
    const expected = ["low", "low", "medium", "high", "xhigh", "max"];
    for (let level = 0 as ReasoningLevel; level <= 5; level = (level + 1) as ReasoningLevel) {
      assert.equal(toClaudeEffort(level), expected[level]);
    }
  });

  it("maps 0..5 to Codex model_reasoning_effort values (none/minimal/low/medium/high/xhigh)", () => {
    const expected = ["none", "minimal", "low", "medium", "high", "xhigh"];
    for (let level = 0 as ReasoningLevel; level <= 5; level = (level + 1) as ReasoningLevel) {
      assert.equal(toCodexEffort(level), expected[level]);
    }
  });

  it("level 5 maps to each provider's heaviest reasoning value", () => {
    assert.equal(toClaudeEffort(5), "max");
    assert.equal(toCodexEffort(5), "xhigh");
  });

  it("level 0 maps to the lightest available reasoning per provider", () => {
    // Claude has no "none"/"off"; lightest is `low`.
    assert.equal(toClaudeEffort(0), "low");
    // Codex's lightest is `none` (no reasoning at all).
    assert.equal(toCodexEffort(0), "none");
  });
});
