/**
 * hook.ts — Claude Code PermissionRequest hook handler
 *
 * Configured in .claude/settings.json:
 *   "PermissionRequest": [{ "matcher": ".*", "hooks": [{ "type": "command", "async": true,
 *     "command": "\"$CLAUDE_PROJECT_DIR\"/node_modules/.bin/tsx \"$CLAUDE_PROJECT_DIR\"/src/scripts/hook.ts" }] }]
 *
 * Fires exactly when a permission dialog is about to appear to the user.
 * Emits "permission_needed" to SQLite for the currently running skill.
 * Always exits 0 — never blocks the permission dialog.
 *
 * stdin payload:
 *   { hook_event_name, tool_name, tool_input, permission_suggestions?, ... }
 */

import { getDb } from "../db/schema.js";

const chunks: Buffer<ArrayBufferLike>[] = [];
process.stdin.on("data", (chunk: Buffer<ArrayBufferLike>) => chunks.push(chunk));

process.stdin.on("end", () => {
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    if (!raw) process.exit(0);

    const input = JSON.parse(raw) as {
      hook_event_name?: string;
      tool_name?: string;
      tool_input?: Record<string, unknown>;
    };

    const toolName = input.tool_name ?? "unknown";
    const toolInput = input.tool_input ?? {};

    const db = getDb();

    // Find currently running skill:
    // latest 'called' event that has no subsequent 'success' or 'failed'
    const latestCalled = db.prepare(`
      SELECT skill FROM skill_events
      WHERE type = 'called'
        AND id > COALESCE(
          (SELECT MAX(id) FROM skill_events WHERE type IN ('success', 'failed')),
          0
        )
      ORDER BY id DESC LIMIT 1
    `).get() as { skill: string } | null;

    // Only emit if we're inside a skill run
    if (!latestCalled) process.exit(0);

    const summary =
      toolName === "Bash"                  ? String(toolInput.command ?? "").slice(0, 120) :
      toolName === "Write"                 ? String(toolInput.file_path ?? "") :
      toolName === "Edit" || toolName === "MultiEdit"
                                           ? String(toolInput.file_path ?? "") :
      JSON.stringify(toolInput).slice(0, 120);

    db.prepare(
      `INSERT INTO skill_events (skill, type, message, data) VALUES (?, ?, ?, ?)`
    ).run(
      latestCalled.skill,
      "permission_needed",
      `${toolName}: ${summary}`,
      JSON.stringify({ tool_name: toolName, tool_input: toolInput })
    );
  } catch {
    // Never block on hook error
  }
  process.exit(0);
});
