/**
 * Claude provider cross-provider history injection.
 *
 * Upstream of the adapter: when ClaudeCodeProvider.spawn receives a
 * CanonicalBlock[] history, it must write a JSONL session file and pass
 * `--resume <file>` to the Claude CLI. This must happen regardless of whether
 * a prompt is also supplied — cross-provider restart arrives with history and
 * no prompt, and the user's next stdin message is expected to see prior
 * context.
 *
 * Regression this guards against (observed live): the history injection path
 * was previously gated on `options.prompt`, so Codex → Claude restart spawned
 * Claude with no --resume, losing the entire prior conversation.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { ClaudeCodeProvider } from "../src/core/providers/claude-code.js";
import type { CanonicalBlock } from "../src/history/types.js";
import { startMockClaudeCli, type MockClaudeCli } from "./mock-claude-cli.js";

async function waitFor(fn: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("ClaudeCodeProvider history injection", () => {
  let mock: MockClaudeCli;
  let cwd: string;
  const origClaudeCmd = process.env.SNA_CLAUDE_COMMAND;

  before(() => {
    mock = startMockClaudeCli();
    process.env.SNA_CLAUDE_COMMAND = mock.command;
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-spawn-test-"));
  });

  after(() => {
    if (origClaudeCmd === undefined) delete process.env.SNA_CLAUDE_COMMAND;
    else process.env.SNA_CLAUDE_COMMAND = origClaudeCmd;
    mock.close();
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => { mock.reset(); });

  it("REGRESSION: history is injected via --resume <jsonl> even when no prompt is supplied", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "I'm Yoonsu." },
      { actor: "assistant", kind: "text", content: "Hello Yoonsu." },
    ];
    const provider = new ClaudeCodeProvider();
    const proc = provider.spawn({
      cwd,
      history,
      // no prompt, no resumeSessionId — this is the Codex → Claude restart path
    });

    await waitFor(() => mock.readInvocations().length > 0);
    proc.kill();

    const inv = mock.readInvocations()[0];
    const resumePath = mock.flagValue(inv.argv, "--resume");
    assert.ok(resumePath, "--resume <file> must be present even without a prompt");
    assert.ok(fs.existsSync(resumePath!), `JSONL session file should exist at ${resumePath}`);

    // Content sanity: JSONL preserves the prior conversation.
    const lines = fs.readFileSync(resumePath!, "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "JSONL should contain both prior turns");
    const first = JSON.parse(lines[0]);
    assert.equal(first.type, "user");
    assert.equal(first.message.content[0].text, "I'm Yoonsu.");
  });

  it("history + prompt: both --resume and the initial prompt reach the CLI", async () => {
    const history: CanonicalBlock[] = [
      { actor: "user", kind: "text", content: "prior turn" },
      { actor: "assistant", kind: "text", content: "acknowledged" },
    ];
    const provider = new ClaudeCodeProvider();
    const proc = provider.spawn({ cwd, history, prompt: "next question" });

    await waitFor(() => mock.readInvocations().length > 0);
    proc.kill();

    const inv = mock.readInvocations()[0];
    assert.ok(mock.flagValue(inv.argv, "--resume"), "--resume flag missing");
    // --system-prompt is separate; the user prompt goes via stdin in real CC,
    // so we don't assert it via argv here. We only verify resume was set.
  });

  it("no history + no resume: spawn proceeds without --resume", async () => {
    const provider = new ClaudeCodeProvider();
    const proc = provider.spawn({ cwd, prompt: "fresh question" });

    await waitFor(() => mock.readInvocations().length > 0);
    proc.kill();

    const inv = mock.readInvocations()[0];
    assert.equal(
      mock.flagValue(inv.argv, "--resume"),
      null,
      "no history → no --resume",
    );
  });
});
