import { HistoryMessage } from '../core/providers/types.js';

/**
 * Build HistoryMessage[] from chat_messages DB records.
 *
 * Filters to user/assistant roles, ensures alternation,
 * and merges consecutive same-role messages.
 */

/**
 * Load conversation history from DB for a session.
 * Returns alternating user↔assistant messages ready for JSONL injection.
 */
declare function buildHistoryFromDb(sessionId: string): HistoryMessage[];

export { buildHistoryFromDb };
