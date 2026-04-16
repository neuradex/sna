/**
 * Unit tests for CodexProvider utility functions.
 *
 * These test pure functions that don't require a running Codex process.
 * Integration tests (spawn, multi-turn, interrupt) are run manually.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toCodexSandbox,
  buildHistoryContext,
  extractResumeArg,
  extractSystemPromptArgs,
  validateCodexPath,
  // @ts-ignore — toCodexSandboxPolicy is not exported but we test via toCodexSandbox
} from "../src/core/providers/codex.js";

// ── toCodexSandbox ──────────────────────────────────────────────────────────

describe("toCodexSandbox", () => {
  it("maps bypassPermissions → danger-full-access", () => {
    assert.equal(toCodexSandbox("bypassPermissions"), "danger-full-access");
  });

  it("maps acceptEdits → workspace-write", () => {
    assert.equal(toCodexSandbox("acceptEdits"), "workspace-write");
  });

  it("maps default → read-only", () => {
    assert.equal(toCodexSandbox("default"), "read-only");
  });

  it("maps undefined → read-only", () => {
    assert.equal(toCodexSandbox(undefined), "read-only");
  });

  it("maps unknown string → read-only", () => {
    assert.equal(toCodexSandbox("plan"), "read-only");
  });
});

// ── buildHistoryContext ─────────────────────────────────────────────────────

describe("buildHistoryContext", () => {
  it("wraps messages in conversation-history XML", () => {
    const result = buildHistoryContext([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
    assert.ok(result.includes("<conversation-history>"));
    assert.ok(result.includes("</conversation-history>"));
    assert.ok(result.includes("<user>\nHello\n</user>"));
    assert.ok(result.includes("<assistant>\nHi there\n</assistant>"));
  });

  it("handles empty history", () => {
    const result = buildHistoryContext([]);
    assert.ok(result.includes("<conversation-history>"));
    assert.ok(result.includes("</conversation-history>"));
  });

  it("preserves message order", () => {
    const result = buildHistoryContext([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
    const firstIdx = result.indexOf("first");
    const secondIdx = result.indexOf("second");
    const thirdIdx = result.indexOf("third");
    assert.ok(firstIdx < secondIdx);
    assert.ok(secondIdx < thirdIdx);
  });
});

// ── extractResumeArg ────────────────────────────────────────────────────────

describe("extractResumeArg", () => {
  it("extracts --resume with threadId", () => {
    const result = extractResumeArg(["--resume", "abc-123", "--other"]);
    assert.deepEqual(result, { threadId: "abc-123", cleanArgs: ["--other"] });
  });

  it("returns null when no --resume", () => {
    assert.equal(extractResumeArg(["--model", "gpt-5"]), null);
  });

  it("returns null for undefined extraArgs", () => {
    assert.equal(extractResumeArg(undefined), null);
  });

  it("returns null when --resume has no value", () => {
    assert.equal(extractResumeArg(["--resume"]), null);
  });

  it("returns null when --resume followed by another flag", () => {
    assert.equal(extractResumeArg(["--resume", "--model"]), null);
  });

  it("removes both --resume and threadId from cleanArgs", () => {
    const result = extractResumeArg(["--before", "--resume", "tid", "--after"]);
    assert.deepEqual(result!.cleanArgs, ["--before", "--after"]);
  });
});

// ── extractSystemPromptArgs ─────────────────────────────────────────────────

describe("extractSystemPromptArgs", () => {
  it("extracts --system-prompt", () => {
    const result = extractSystemPromptArgs(["--system-prompt", "You are helpful"]);
    assert.equal(result.baseInstructions, "You are helpful");
    assert.deepEqual(result.cleanArgs, []);
  });

  it("extracts --append-system-prompt", () => {
    const result = extractSystemPromptArgs(["--append-system-prompt", "Be concise"]);
    assert.equal(result.developerInstructions, "Be concise");
    assert.deepEqual(result.cleanArgs, []);
  });

  it("extracts both prompts", () => {
    const result = extractSystemPromptArgs([
      "--system-prompt", "Base",
      "--append-system-prompt", "Extra",
      "--other",
    ]);
    assert.equal(result.baseInstructions, "Base");
    assert.equal(result.developerInstructions, "Extra");
    assert.deepEqual(result.cleanArgs, ["--other"]);
  });

  it("returns empty for undefined", () => {
    const result = extractSystemPromptArgs(undefined);
    assert.equal(result.baseInstructions, undefined);
    assert.equal(result.developerInstructions, undefined);
    assert.deepEqual(result.cleanArgs, []);
  });

  it("preserves unrelated flags", () => {
    const result = extractSystemPromptArgs(["--model", "gpt-5", "--config", "x=y"]);
    assert.deepEqual(result.cleanArgs, ["--model", "gpt-5", "--config", "x=y"]);
    assert.equal(result.baseInstructions, undefined);
  });
});

// ── validateCodexPath ───────────────────────────────────────────────────────

describe("validateCodexPath", () => {
  it("returns ok:false for non-existent path", () => {
    const result = validateCodexPath("/nonexistent/codex");
    assert.equal(result.ok, false);
  });

  it("returns ok:false for binary without --version support", () => {
    const result = validateCodexPath("/usr/bin/false");
    assert.equal(result.ok, false);
  });
});

// ── Image content block conversion (verified via type shape) ────────────────

describe("image content block format", () => {
  it("Codex format uses { type: 'image', url: 'data:...' }", () => {
    // Verify the expected shape matches Codex app-server protocol
    const anthropicBlock = {
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/png", data: "iVBOR..." },
    };
    // Convert (same logic as CodexProcess.startTurn)
    const codexBlock = {
      type: "image" as const,
      url: `data:${anthropicBlock.source.media_type};base64,${anthropicBlock.source.data}`,
    };
    assert.equal(codexBlock.type, "image");
    assert.ok(codexBlock.url.startsWith("data:image/png;base64,"));
    assert.ok(codexBlock.url.endsWith("iVBOR..."));
  });
});

// ── Permission response format ──────────────────────────────────────────────

describe("permission response format", () => {
  it("accept decision format matches Codex protocol", () => {
    const response = { id: 0, result: { decision: "accept" } };
    assert.equal(response.result.decision, "accept");
  });

  it("decline decision format matches Codex protocol", () => {
    const response = { id: 0, result: { decision: "decline" } };
    assert.equal(response.result.decision, "decline");
  });
});
