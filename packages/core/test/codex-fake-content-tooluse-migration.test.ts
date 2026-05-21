import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, resetDb } from "../src/db/schema.js";
import { buildCanonicalFromDb } from "../src/history/canonical.js";
import { canonicalToCodexResponseItems } from "../src/history/codex.js";

describe("DB migration — fake Codex content tool_use cleanup", () => {
  const origDbPath = process.env.SNA_DB_PATH;
  let tmpDir: string | null = null;

  afterEach(() => {
    try { getDb().close(); } catch {}
    resetDb();
    if (origDbPath === undefined) delete process.env.SNA_DB_PATH;
    else process.env.SNA_DB_PATH = origDbPath;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("removes previously persisted agentMessage/reasoning fake tool rows before canonical replay", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-codex-fake-tool-"));
    process.env.SNA_DB_PATH = path.join(tmpDir, "sna.db");
    resetDb();

    const db = getDb();
    db.prepare("INSERT INTO chat_sessions (id, label) VALUES (?, ?)").run("s1", "Test");
    db.prepare(
      "INSERT INTO chat_messages (session_id, actor, kind, content, meta) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "user", "text", "hello", null);
    db.prepare(
      "INSERT INTO chat_messages (session_id, actor, kind, content, meta) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "assistant", "tool_use", "agentMessage", JSON.stringify({
      toolName: "agentMessage",
      id: "msg_1",
      raw: { type: "agentMessage", id: "msg_1" },
    }));
    db.prepare(
      "INSERT INTO chat_messages (session_id, actor, kind, content, meta) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "assistant", "tool_use", "reasoning", JSON.stringify({
      toolName: "reasoning",
      id: "rs_1",
      raw: { type: "reasoning", id: "rs_1" },
    }));
    db.prepare(
      "INSERT INTO chat_messages (session_id, actor, kind, content, meta) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "assistant", "thinking", "real thinking", null);
    db.prepare(
      "INSERT INTO chat_messages (session_id, actor, kind, content, meta) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "assistant", "text", "real answer", null);
    db.prepare(
      "INSERT INTO chat_messages (session_id, actor, kind, content, meta) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "assistant", "tool_use", "future_widget", JSON.stringify({
      toolName: "future_widget",
      id: "fw_1",
      raw: { type: "future_widget", id: "fw_1" },
    }));
    db.close();
    resetDb();

    const reopened = getDb();
    const toolRows = reopened.prepare(
      "SELECT content FROM chat_messages WHERE session_id = ? AND actor = 'assistant' AND kind = 'tool_use' ORDER BY id",
    ).all("s1") as Array<{ content: string }>;
    assert.deepEqual(toolRows.map((row) => row.content), ["future_widget"]);

    const canonical = buildCanonicalFromDb("s1");
    assert.deepEqual(
      canonical
        .filter((block) => block.actor === "assistant" && block.kind === "tool_use")
        .map((block) => block.content),
      ["future_widget"],
    );

    const codexItems = canonicalToCodexResponseItems(canonical, "s1");
    assert.equal(
      codexItems.some((item) => item.type === "function_call" && item.name === "reasoning"),
      false,
      "fake reasoning tool_use must not become a Codex function_call on resume",
    );
    assert.equal(
      codexItems.some((item) => item.type === "function_call" && item.name === "agentMessage"),
      false,
      "fake agentMessage tool_use must not become a Codex function_call on resume",
    );
  });
});
