import { getDb } from "../db/schema.js";
function parseArgs(args2) {
  const result = {};
  for (let i = 0; i < args2.length; i += 2) {
    const key = args2[i]?.replace(/^--/, "");
    if (key) result[key] = args2[i + 1] ?? "";
  }
  return result;
}
const [, , ...args] = process.argv;
const flags = parseArgs(args);
const VALID_TYPES = [
  "called",
  "success",
  "failed",
  "permission_needed",
  "start",
  "progress",
  "milestone",
  "complete",
  "error"
];
if (!flags.skill || !flags.type || !flags.message) {
  console.error("Usage: tsx node_modules/sna/src/scripts/emit.ts --skill <name> --type <type> --message <text> [--data <json>]");
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
const prefix = {
  called: "\u2192",
  success: "\u2713",
  failed: "\u2717",
  permission_needed: "\u26A0",
  start: "\u25B6",
  progress: "\xB7",
  milestone: "\u25C6",
  complete: "\u2713",
  error: "\u2717"
};
const p = prefix[flags.type] ?? "\xB7";
console.log(`${p} [${flags.skill}] ${flags.message}`);
