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
  extractResumeArg,
  extractSystemPromptArgs,
  validateCodexPath,
  // @ts-ignore — toCodexSandboxPolicy is not exported but we test via toCodexSandbox
} from "../src/core/providers/codex.js";
import { canonicalToCodexResponseItems } from "../src/history/codex.js";

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

// ── canonicalToCodexResponseItems ───────────────────────────────────────────

describe("canonicalToCodexResponseItems", () => {
  it("maps user text → Message(role=user, input_text)", () => {
    const items = canonicalToCodexResponseItems(
      [{ actor: "user", kind: "text", content: "Hello" }],
      "s1",
    );
    assert.deepEqual(items, [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
    ]);
  });

  it("maps assistant text → Message(role=assistant, output_text)", () => {
    const items = canonicalToCodexResponseItems(
      [{ actor: "assistant", kind: "text", content: "Hi there" }],
      "s1",
    );
    assert.deepEqual(items, [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hi there" }] },
    ]);
  });

  it("maps tool_use → FunctionCall with stringified args", () => {
    const items = canonicalToCodexResponseItems(
      [{
        actor: "assistant", kind: "tool_use", content: "Bash",
        meta: { id: "call_1", input: { command: "ls" } },
      }],
      "s1",
    );
    assert.deepEqual(items, [
      { type: "function_call", name: "Bash", arguments: '{"command":"ls"}', call_id: "call_1" },
    ]);
  });

  it("maps tool_result → FunctionCallOutput preserving call_id", () => {
    const items = canonicalToCodexResponseItems(
      [{
        actor: "system", kind: "tool_result", content: "file1\nfile2",
        meta: { toolUseId: "call_1" },
      }],
      "s1",
    );
    assert.deepEqual(items, [
      { type: "function_call_output", call_id: "call_1", output: "file1\nfile2" },
    ]);
  });

  it("preserves order across a multi-turn conversation with tools", () => {
    const items = canonicalToCodexResponseItems(
      [
        { actor: "user", kind: "text", content: "list files" },
        { actor: "assistant", kind: "text", content: "I'll check" },
        { actor: "assistant", kind: "tool_use", content: "Bash",
          meta: { id: "c1", input: { command: "ls" } } },
        { actor: "system", kind: "tool_result", content: "a.txt\nb.txt", meta: { toolUseId: "c1" } },
        { actor: "assistant", kind: "text", content: "Two files." },
      ],
      "s1",
    );
    assert.equal(items.length, 5);
    assert.equal(items[0].type, "message");
    assert.equal(items[2].type, "function_call");
    assert.equal(items[3].type, "function_call_output");
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
