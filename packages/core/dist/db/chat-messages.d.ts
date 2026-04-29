import Database from 'better-sqlite3';
import { ChatActor, ChatKind } from './schema.js';
import { EmbedRecord } from '../history/types.js';

/**
 * Unified write helpers for chat_messages. Single INSERT path so every row
 * carries a consistent (actor, kind) pair and serialized embeds/meta.
 */

interface InsertChatMessage {
    sessionId: string;
    actor: ChatActor;
    kind: ChatKind;
    content: string;
    /** Embed dictionary keyed by embed id (same id used in `embed://` refs). */
    embeds?: Record<string, EmbedRecord>;
    meta?: Record<string, unknown>;
}
/** Insert a chat_messages row. Returns the autoincrement id. */
declare function insertChatMessage(db: Database.Database, msg: InsertChatMessage): number;
/**
 * Update an existing chat_messages row's meta (streaming tool_use input
 * completions overwrite earlier partial input). updated_at refreshes.
 */
declare function updateChatMessageMeta(db: Database.Database, id: number, meta: Record<string, unknown>): void;

export { type InsertChatMessage, insertChatMessage, updateChatMessageMeta };
