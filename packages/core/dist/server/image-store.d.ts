import { EmbedRecord } from '../history/types.js';
import '../db/schema.js';
import 'better-sqlite3';

/**
 * Image/file storage — persists base64-encoded attachments to disk under
 * `dataDir/images/{sessionId}/{sha256_prefix}.{ext}` and returns canonical
 * EmbedRecord entries for session-manager to stash in `chat_messages.embeds`.
 *
 * Filenames are content-hashed so identical uploads dedup at the filesystem
 * level automatically. The embed id used in inline refs (`![](embed://<id>)`)
 * is the hash prefix — so referencing the same file twice writes the same id.
 *
 * Retrieve via HTTP: GET /chat/images/:sessionId/:filename
 */

interface SavedEmbed {
    /** Short id used in inline refs: `![](embed://<id>)`. */
    id: string;
    /** Canonical embed record — what goes into the row's `embeds` JSON. */
    record: EmbedRecord;
}
/**
 * Save base64 attachments to disk. Returns {id, record} per input, in order.
 * Callers typically embed the id into content text via formatEmbedRef() and
 * merge records into the chat_messages row's embeds column.
 */
declare function saveEmbeds(sessionId: string, attachments: Array<{
    base64: string;
    mimeType: string;
}>): SavedEmbed[];
/**
 * Resolve an attachment file path given a session + filename from a URL.
 * Returns null if missing or if traversal is attempted.
 */
declare function resolveImagePath(sessionId: string, filename: string): string | null;

export { type SavedEmbed, resolveImagePath, saveEmbeds };
