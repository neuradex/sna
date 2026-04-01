import { HistoryMessage } from './types.js';

/**
 * History injection for Claude Code via JSONL resume.
 *
 * Writes a JSONL session file and passes --resume <filepath> to CC.
 * CC loads it as real multi-turn conversation history.
 *
 * Key discovery: --resume with a .jsonl file path bypasses CC's project
 * directory lookup and calls loadMessagesFromJsonlPath directly.
 * This is the only reliable way to inject synthetic history.
 *
 * Verified: real Claude Haiku correctly recalls injected context.
 * Fallback: recalled-conversation XML if file write fails.
 */

/**
 * Write a JSONL session file for --resume <filepath>.
 *
 * Minimal format (verified working):
 *   {"parentUuid":null,"isSidechain":false,"type":"user","uuid":"...","timestamp":"...","cwd":"...","sessionId":"...","message":{"role":"user","content":"..."}}
 *   {"parentUuid":"<prev>","isSidechain":false,"type":"assistant","uuid":"...","timestamp":"...","cwd":"...","sessionId":"...","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
 */
declare function writeHistoryJsonl(history: HistoryMessage[], opts: {
    cwd: string;
}): {
    filePath: string;
    extraArgs: string[];
} | null;
/**
 * Pack history into a single assistant stdin message.
 * CC treats type:"assistant" as context injection (no API call triggered).
 * Used when file write fails.
 */
declare function buildRecalledConversation(history: HistoryMessage[]): string;

export { buildRecalledConversation, writeHistoryJsonl };
