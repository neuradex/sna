import { CanonicalBlock } from './types.js';
import '../db/schema.js';
import 'better-sqlite3';

/**
 * Claude Code history adapter.
 *
 * Converts canonical blocks into Anthropic's native wire format and writes a
 * JSONL session file that Claude Code's CLI accepts via `--resume <filepath>`.
 * (Key discovery: passing a .jsonl path to --resume bypasses CC's project
 * directory lookup and calls loadMessagesFromJsonlPath directly — this is the
 * only reliable way to inject synthetic history into CC.)
 *
 * Anthropic wire format quirks handled here:
 *   - assistant text + tool_use blocks are packed into a single assistant
 *     message (preserves parallel tool-call batching)
 *   - tool_result blocks are wrapped in a synthetic user message (per Anthropic
 *     convention, even though tool output is semantically from the system)
 *   - images inline refs (`![](embed://<id>)`) are resolved from each block's
 *     embeds map and emitted as `{type:"image",source:{base64}}` blocks
 *     interleaved with text, preserving the order the user/tool produced them
 */

interface ClaudeHistoryResult {
    /** Absolute path to the written JSONL session file. */
    filePath: string;
    /** CLI args to append to claude invocation (typically `["--resume", filePath]`). */
    extraArgs: string[];
}
/**
 * Convert canonical blocks into a Claude Code JSONL session file and return
 * the CLI args needed to resume from it. Returns null if the directory cannot
 * be created or file cannot be written (caller falls back to no-history).
 */
declare function writeClaudeHistoryJsonl(blocks: CanonicalBlock[], opts: {
    cwd: string;
    sessionId: string;
}): ClaudeHistoryResult | null;

export { type ClaudeHistoryResult, writeClaudeHistoryJsonl };
