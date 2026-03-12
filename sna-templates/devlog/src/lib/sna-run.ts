/**
 * sna-run — Awaitable skill invocation for SNA pipelines.
 *
 * Lets you chain Claude Code skills programmatically using async/await.
 * Each skill runs as a real Claude Code invocation and emits events
 * to the same SQLite event bus — so the frontend sees everything via useSna().
 *
 * @example
 * // src/scripts/weekly-pipeline.ts  (called from a SKILL.md)
 * import { sna } from "@/lib/sna-run";
 *
 * await sna.run("/devlog-collect");
 * await sna.run("/devlog-analyze --week");
 * await sna.run("/devlog-report");
 *
 * @example
 * // With args
 * await sna.run("/say-hello 123123");
 * await sna.run("/say-goodbye 0012 1131 12312");
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "@/db/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const STATE_DIR = path.join(ROOT, ".sna");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");

const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function getClaudePath(): string {
  if (fs.existsSync(CLAUDE_PATH_FILE)) {
    return fs.readFileSync(CLAUDE_PATH_FILE, "utf-8").trim();
  }
  // Fallback common locations
  for (const p of ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Claude binary not found. Run /sna-up first.");
}

/** Parse skill name from a slash command: "/devlog-collect --week" → "devlog-collect" */
function parseSkillName(command: string): string {
  return command.trim().replace(/^\//, "").split(/\s+/)[0];
}

/** Poll skill_events until complete or error, then resolve/reject. */
function waitForComplete(skill: string, afterId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`Skill "${skill}" timed out after ${timeoutMs / 1000}s`));
        return;
      }

      const db = getDb();
      const row = db.prepare(`
        SELECT type, message FROM skill_events
        WHERE skill = ? AND id > ? AND type IN ('complete', 'success', 'error', 'failed')
        ORDER BY id ASC LIMIT 1
      `).get(skill, afterId) as { type: string; message: string } | undefined;

      if (!row) return;

      clearInterval(timer);
      if (row.type === "complete" || row.type === "success") {
        resolve();
      } else {
        reject(new Error(`Skill "${skill}" failed: ${row.message}`));
      }
    }, POLL_INTERVAL_MS);
  });
}

/** Get the latest event ID (to ignore pre-existing events for this skill) */
function getLatestEventId(): number {
  const db = getDb();
  const row = db.prepare("SELECT MAX(id) as id FROM skill_events").get() as { id: number | null };
  return row.id ?? 0;
}

export const sna = {
  /**
   * Invoke a Claude Code skill by slash command and await its completion.
   *
   * Spawns Claude in `--print` mode, waits for the skill to emit
   * a `complete` or `error` event to SQLite, then resolves or rejects.
   *
   * @param command - Slash command with optional args, e.g. "/devlog-collect --since 7d"
   * @param opts.timeout - Max wait time in ms (default: 5 minutes)
   */
  run: async (command: string, opts?: { timeout?: number }): Promise<void> => {
    const skillName = parseSkillName(command);
    const timeoutMs = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const afterId = getLatestEventId();
    const claudePath = getClaudePath();

    // Spawn Claude Code with the slash command in print mode
    spawn(claudePath, ["--print", command], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });

    // Wait for the skill to signal completion via skill_events
    await waitForComplete(skillName, afterId, timeoutMs);
  },
};
