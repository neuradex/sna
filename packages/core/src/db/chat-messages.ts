/**
 * Unified write helpers for chat_messages. Single INSERT path so every row
 * carries a consistent (actor, kind) pair and serialized embeds/meta.
 */

import type Database from "better-sqlite3";
import type { ChatActor, ChatKind } from "./schema.js";
import type { EmbedRecord } from "../history/types.js";

export interface InsertChatMessage {
  sessionId: string;
  actor: ChatActor;
  kind: ChatKind;
  content: string;
  /** Embed dictionary keyed by embed id (same id used in `embed://` refs). */
  embeds?: Record<string, EmbedRecord>;
  meta?: Record<string, unknown>;
  skillName?: string;
}

/** Insert a chat_messages row. Returns the autoincrement id. */
export function insertChatMessage(db: Database.Database, msg: InsertChatMessage): number {
  const embedsJson = msg.embeds && Object.keys(msg.embeds).length > 0 ? JSON.stringify(msg.embeds) : null;
  const metaJson = msg.meta && Object.keys(msg.meta).length > 0 ? JSON.stringify(msg.meta) : null;
  const result = db.prepare(
    `INSERT INTO chat_messages (session_id, actor, kind, content, embeds, meta, skill_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.sessionId,
    msg.actor,
    msg.kind,
    msg.content,
    embedsJson,
    metaJson,
    msg.skillName ?? null,
  );
  return Number(result.lastInsertRowid);
}

/**
 * Update an existing chat_messages row's meta (streaming tool_use input
 * completions overwrite earlier partial input). updated_at refreshes.
 */
export function updateChatMessageMeta(
  db: Database.Database,
  id: number,
  meta: Record<string, unknown>,
): void {
  db.prepare(
    `UPDATE chat_messages SET meta = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(meta), id);
}
