import { HistoryMessage } from './types.js';

/**
 * History injection adapters for Claude Code.
 *
 * Primary: JSONL resume — writes a session file and uses --resume.
 *   Pro: Real multi-turn structure, tool_use preserved.
 *   Con: Depends on CC's JSONL format, CLAUDE_CONFIG_DIR path.
 *
 * Fallback: recalled-conversation — packs history into a single assistant message.
 *   Pro: No file system dependency, format-agnostic.
 *   Con: Loses turn structure (text only).
 */

/**
 * Write a synthetic JSONL session file that CC can --resume.
 * Returns the session ID to pass as --resume <id>.
 *
 * File location: {configDir}/projects/{projectHash}/{sessionId}.jsonl
 */
declare function writeSessionJsonl(history: HistoryMessage[], opts: {
    cwd: string;
    configDir?: string;
}): {
    sessionId: string;
    extraArgs: string[];
} | null;
/**
 * Pack history into a single assistant stdin message using XML tags.
 * CC treats type:"assistant" as mutableMessages.push + continue (no API call).
 */
declare function buildRecalledConversation(history: HistoryMessage[]): string;

export { buildRecalledConversation, writeSessionJsonl };
