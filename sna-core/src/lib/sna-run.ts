/**
 * sna-run — Awaitable skill invocation for SNA pipelines.
 *
 * Lets you chain Claude Code skills programmatically using async/await.
 *
 * @example
 * import { sna } from "sna/lib/sna-run";
 *
 * await sna.run("/devlog-collect");
 * await sna.run("/devlog-analyze --week");
 * await sna.run("/devlog-report");
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getDb } from "../db/schema.js";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".sna");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");

const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function getClaudePath(): string {
  if (fs.existsSync(CLAUDE_PATH_FILE)) {
    return fs.readFileSync(CLAUDE_PATH_FILE, "utf-8").trim();
  }
  for (const p of ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Claude binary not found. Run /lna-up first.");
}

function parseSkillName(command: string): string {
  return command.trim().replace(/^\//, "").split(/\s+/)[0];
}

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

function getLatestEventId(): number {
  const db = getDb();
  const row = db.prepare("SELECT MAX(id) as id FROM skill_events").get() as { id: number | null };
  return row.id ?? 0;
}

export const sna = {
  /**
   * Invoke a Claude Code skill by slash command and await its completion.
   *
   * @param command - e.g. "/devlog-collect --since 7d"
   * @param opts.timeout - Max wait time in ms (default: 5 minutes)
   */
  run: async (command: string, opts?: { timeout?: number }): Promise<void> => {
    const skillName = parseSkillName(command);
    const timeoutMs = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const afterId = getLatestEventId();
    const claudePath = getClaudePath();

    spawn(claudePath, ["--print", command], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });

    await waitForComplete(skillName, afterId, timeoutMs);
  },
};
