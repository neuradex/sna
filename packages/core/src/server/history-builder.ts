/**
 * Build HistoryMessage[] from chat_messages DB records.
 *
 * Filters to user/assistant roles, ensures alternation,
 * and merges consecutive same-role messages.
 */

import { getDb } from "../db/schema.js";
import type { HistoryMessage } from "../core/providers/types.js";

/**
 * Load conversation history from DB for a session.
 * Returns alternating user↔assistant messages ready for JSONL injection.
 */
export function buildHistoryFromDb(sessionId: string): HistoryMessage[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT role, content FROM chat_messages
     WHERE session_id = ? AND role IN ('user', 'assistant')
     ORDER BY id ASC`,
  ).all(sessionId) as { role: string; content: string }[];

  if (rows.length === 0) return [];

  // Merge consecutive same-role messages and ensure alternation
  const merged: HistoryMessage[] = [];
  for (const row of rows) {
    const role = row.role as "user" | "assistant";
    if (!row.content?.trim()) continue;

    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      // Merge with previous
      last.content += "\n\n" + row.content;
    } else {
      merged.push({ role, content: row.content });
    }
  }

  return merged;
}
