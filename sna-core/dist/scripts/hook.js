import { getDb } from "../db/schema.js";
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    if (!raw) process.exit(0);
    const input = JSON.parse(raw);
    const toolName = input.tool_name ?? "unknown";
    const toolInput = input.tool_input ?? {};
    const db = getDb();
    const latestCalled = db.prepare(`
      SELECT skill FROM skill_events
      WHERE type = 'called'
        AND id > COALESCE(
          (SELECT MAX(id) FROM skill_events WHERE type IN ('success', 'failed')),
          0
        )
      ORDER BY id DESC LIMIT 1
    `).get();
    const skillName = latestCalled?.skill ?? "system";
    const summary = toolName === "Bash" ? String(toolInput.command ?? "").slice(0, 120) : toolName === "Write" ? String(toolInput.file_path ?? "") : toolName === "Edit" || toolName === "MultiEdit" ? String(toolInput.file_path ?? "") : JSON.stringify(toolInput).slice(0, 120);
    db.prepare(
      `INSERT INTO skill_events (skill, type, message, data) VALUES (?, ?, ?, ?)`
    ).run(
      skillName,
      "permission_needed",
      `${toolName}: ${summary}`,
      JSON.stringify({ tool_name: toolName, tool_input: toolInput })
    );
  } catch {
  }
  process.exit(0);
});
