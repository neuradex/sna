import { CanonicalBlock } from './types.js';
import '../db/schema.js';
import 'better-sqlite3';

/**
 * Build canonical blocks from the chat_messages DB table.
 *
 * Single read path that consumers (Langfuse tracer, cross-provider history
 * adapters, UI reconstruction) use. Returns full-resolution data (actor, kind,
 * content, embeds, meta) without any provider-specific reshaping — that
 * happens in adapters under `./claude-code` and `./codex`.
 *
 * Ordering is strictly by row id (ascending) which matches emission order.
 * That ordering is the only signal adapters need to reconstruct parallel
 * tool_use batching for Anthropic wire format (multiple tool_uses before the
 * first tool_result → same assistant message).
 */

/** Load all canonical blocks for a session in emission order. */
declare function buildCanonicalFromDb(sessionId: string): CanonicalBlock[];

export { buildCanonicalFromDb };
