/**
 * Canonical → Claude JSONL adapter tests.
 *
 * writeClaudeHistoryJsonl reshapes CanonicalBlock[] into Anthropic's native
 * wire format (user/assistant messages with content block arrays) and writes
 * a JSONL session file Claude Code can --resume from.
 *
 * Anthropic's API enforces a few invariants that history must satisfy or the
 * session simply won't load:
 *   - messages must strictly alternate user↔assistant
 *   - every tool_use block must be followed (in the next user message) by a
 *     tool_result with matching tool_use_id
 *   - content inside a message is an ordered array of blocks (text, tool_use,
 *     tool_result, image), preserving the order the assistant emitted them
 *
 * The tests below encode each invariant as a regression guard.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { writeClaudeHistoryJsonl } from "../src/history/claude-code.js";
import type { CanonicalBlock } from "../src/history/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-history-test-"));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

/** Read the JSONL Claude adapter produced and parse each line's `message` field. */
function readMessages(filePath: string): Array<{ role: string; content: any }> {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l).message);
}

describe("writeClaudeHistoryJsonl", () => {
  it("text-only history alternates user↔assistant", () => {
    const blocks: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "I'm Yoonsu." },
      { actor: "assistant", kind: "text", content: "Nice to meet you." },
      { actor: "user", kind: "text", content: "What's my name?" },
    ];
    const result = writeClaudeHistoryJsonl(blocks, { cwd: tmpDir, sessionId: "s1" });
    assert.ok(result, "adapter should return a file path");
    const msgs = readMessages(result!.filePath);
    assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user"]);
    assert.equal(msgs[0].content[0].text, "I'm Yoonsu.");
    assert.equal(msgs[1].content[0].text, "Nice to meet you.");
  });

  it("tool_use + tool_result pair round-trip into adjacent assistant+user messages", () => {
    const blocks: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "list files" },
      { actor: "assistant", kind: "text", content: "I'll run ls." },
      { actor: "assistant", kind: "tool_use", content: "Bash",
        meta: { id: "call_ls", input: { command: "ls" } } },
      { actor: "system", kind: "tool_result", content: "a.txt\nb.txt",
        meta: { toolUseId: "call_ls" } },
      { actor: "assistant", kind: "text", content: "Two files." },
    ];
    const result = writeClaudeHistoryJsonl(blocks, { cwd: tmpDir, sessionId: "s1" });
    assert.ok(result);
    const msgs = readMessages(result!.filePath);

    // Expected wire sequence:
    //   user  [text "list files"]
    //   assistant [text "I'll run ls.", tool_use(call_ls)]
    //   user  [tool_result(call_ls, "a.txt\nb.txt")]
    //   assistant [text "Two files."]
    assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant"]);

    const assistantWithTool = msgs[1];
    assert.equal(assistantWithTool.content.length, 2);
    assert.equal(assistantWithTool.content[0].type, "text");
    assert.equal(assistantWithTool.content[1].type, "tool_use");
    assert.equal(assistantWithTool.content[1].id, "call_ls");
    assert.equal(assistantWithTool.content[1].name, "Bash");

    const toolResultUser = msgs[2];
    assert.equal(toolResultUser.content[0].type, "tool_result");
    assert.equal(toolResultUser.content[0].tool_use_id, "call_ls");
  });

  it("parallel tool_uses (multiple tool_use before any tool_result) batch into one assistant message", () => {
    // Anthropic's signal for parallel-tool-execution: the assistant emits
    // multiple tool_use blocks in a single response before any tool_result.
    // Canonical row-per-event preserves this implicitly via ordering.
    const blocks: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "check both" },
      { actor: "assistant", kind: "text", content: "I'll check both in parallel." },
      { actor: "assistant", kind: "tool_use", content: "Bash",
        meta: { id: "a", input: { command: "ls" } } },
      { actor: "assistant", kind: "tool_use", content: "Bash",
        meta: { id: "b", input: { command: "pwd" } } },
      { actor: "system", kind: "tool_result", content: "out_a", meta: { toolUseId: "a" } },
      { actor: "system", kind: "tool_result", content: "out_b", meta: { toolUseId: "b" } },
      { actor: "assistant", kind: "text", content: "Done." },
    ];
    const result = writeClaudeHistoryJsonl(blocks, { cwd: tmpDir, sessionId: "s1" });
    assert.ok(result);
    const msgs = readMessages(result!.filePath);
    assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant"]);

    // Both tool_uses live in the SAME assistant message → preserves parallel signal.
    const assistantBatch = msgs[1];
    const toolUseBlocks = assistantBatch.content.filter((b: any) => b.type === "tool_use");
    assert.equal(toolUseBlocks.length, 2);
    assert.deepEqual(toolUseBlocks.map((b: any) => b.id), ["a", "b"]);

    // Both tool_results live in the SAME synthetic user message.
    const toolResultUser = msgs[2];
    const tr = toolResultUser.content.filter((b: any) => b.type === "tool_result");
    assert.equal(tr.length, 2);
    assert.deepEqual(tr.map((b: any) => b.tool_use_id), ["a", "b"]);
  });

  it("REGRESSION: orphan tool_use (no matching tool_result) does not leave an unpair-able tool_use in the JSONL", () => {
    // Bug we observed live: Codex called `remember` which errored out BEFORE a
    // tool_result event fired, so canonical DB had a dangling tool_use row.
    // The adapter needs to either drop that tool_use or synthesize a closing
    // tool_result — otherwise Claude's JSONL loader rejects the session as
    // malformed and we lose the entire prior conversation.
    const blocks: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "I'm Yoonsu, remember me." },
      { actor: "assistant", kind: "text", content: "Sure, I'll remember." },
      { actor: "assistant", kind: "tool_use", content: "remember",
        meta: { id: "call_rem", input: { key: "name", value: "Yoonsu" } } },
      // NO tool_result — simulating a failed/denied tool call
      { actor: "assistant", kind: "text", content: "Noted." },
      { actor: "user", kind: "text", content: "What's my name?" },
    ];
    const result = writeClaudeHistoryJsonl(blocks, { cwd: tmpDir, sessionId: "s1" });
    assert.ok(result, "adapter must still produce a loadable JSONL even with orphan tool_use");
    const msgs = readMessages(result!.filePath);

    // Every tool_use in the transcript must have a matching tool_result in the
    // next user message. Walk the JSONL and enforce this invariant.
    const pendingToolUseIds = new Set<string>();
    for (const m of msgs) {
      if (m.role === "assistant") {
        for (const b of m.content) {
          if (b.type === "tool_use") pendingToolUseIds.add(b.id);
        }
      } else if (m.role === "user") {
        for (const b of m.content) {
          if (b.type === "tool_result") pendingToolUseIds.delete(b.tool_use_id);
        }
      }
    }
    assert.equal(pendingToolUseIds.size, 0,
      `orphan tool_use ids left unpaired: ${[...pendingToolUseIds].join(", ")}`);

    // The user's real question should survive at the end — i.e. the prior
    // conversation context is still intact after fixup.
    const lastUser = msgs[msgs.length - 1];
    assert.equal(lastUser.role, "user");
    const lastText = lastUser.content.find((b: any) => b.type === "text");
    assert.equal(lastText?.text, "What's my name?");
  });

  it("rejects consecutive same-role messages via assertAlternating", () => {
    // If canonical has a run of user→user with no assistant between, adapter
    // should throw — fail loudly rather than write a JSONL CC will reject.
    const blocks: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "first" },
      { actor: "user", kind: "text", content: "second" },
    ];
    assert.throws(
      () => writeClaudeHistoryJsonl(blocks, { cwd: tmpDir, sessionId: "s1" }),
      /consecutive|alternat/i,
    );
  });
});
