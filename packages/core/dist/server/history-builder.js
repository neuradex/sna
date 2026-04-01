import { getDb } from "../db/schema.js";
function buildHistoryFromDb(sessionId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ? AND role IN ('user', 'assistant')
     ORDER BY id ASC`
  ).all(sessionId);
  if (rows.length === 0) return [];
  const merged = [];
  for (const row of rows) {
    const role = row.role;
    if (!row.content?.trim()) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.content += "\n\n" + row.content;
    } else {
      merged.push({ role, content: row.content });
    }
  }
  return merged;
}
export {
  buildHistoryFromDb
};
