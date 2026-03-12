/**
 * emit.ts — SNA Skill Event Emitter
 *
 * Skills call this at key milestones to push real-time updates to the frontend.
 * Events are written to SQLite; the /api/events SSE endpoint streams them to clients.
 *
 * Usage:
 *   tsx src/scripts/emit.ts --skill <name> --type <type> --message "<text>" [--data '<json>']
 *
 * Types:
 *   start      — skill has begun
 *   progress   — incremental update (loops, sub-steps)
 *   milestone  — significant checkpoint worth highlighting
 *   complete   — skill finished successfully
 *   error      — skill failed or encountered an issue
 *
 * Example from inside a SKILL.md:
 *   tsx src/scripts/emit.ts --skill devlog-collect --type start --message "Scanning repos..."
 *   tsx src/scripts/emit.ts --skill devlog-collect --type milestone --message "neuradex: 12 commits found"
 *   tsx src/scripts/emit.ts --skill devlog-collect --type complete --message "Done. 42 commits saved."
 */

import { getDb } from "../db/schema.js";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (key) result[key] = args[i + 1] ?? "";
  }
  return result;
}

const [, , ...args] = process.argv;
const flags = parseArgs(args);

const VALID_TYPES = [
  "called", "success", "failed", "permission_needed",
  "start", "progress", "milestone", "complete", "error",
];

if (!flags.skill || !flags.type || !flags.message) {
  console.error("Usage: tsx emit.ts --skill <name> --type <type> --message <text> [--data <json>]");
  process.exit(1);
}

if (!VALID_TYPES.includes(flags.type)) {
  console.error(`Invalid type: ${flags.type}. Must be one of: ${VALID_TYPES.join(", ")}`);
  process.exit(1);
}

const db = getDb();
db.prepare(`
  INSERT INTO skill_events (skill, type, message, data)
  VALUES (?, ?, ?, ?)
`).run(flags.skill, flags.type, flags.message, flags.data ?? null);

// Print to stdout too so it shows in the Claude Code terminal
const prefix: Record<string, string> = {
  called:            "→",
  success:           "✓",
  failed:            "✗",
  permission_needed: "⚠",
  start:             "▶",
  progress:          "·",
  milestone:         "◆",
  complete:          "✓",
  error:             "✗",
};
const p = prefix[flags.type] ?? "·";

console.log(`${p} [${flags.skill}] ${flags.message}`);
