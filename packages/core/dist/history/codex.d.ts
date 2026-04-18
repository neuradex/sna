import { CanonicalBlock } from './types.js';
import '../db/schema.js';
import 'better-sqlite3';

/**
 * Codex history adapter.
 *
 * Converts canonical blocks into Codex's `ResponseItem[]` sequence, which the
 * app-server accepts via `thread/resume(history=...)` once the experimental
 * feature `thread/resume.history` is enabled.
 *
 * Codex's ResponseItem model is flat (each block is an independent item), so
 * the mapping is nearly 1:1:
 *   canonical.user(text)            → Message(role=user, content=[input_text|input_image])
 *   canonical.assistant(text)       → Message(role=assistant, content=[output_text])
 *   canonical.assistant(thinking)   → Reasoning
 *   canonical.assistant(tool_use)   → FunctionCall
 *   canonical.system(tool_result)   → FunctionCallOutput
 */

type CodexInputText = {
    type: "input_text";
    text: string;
};
type CodexInputImage = {
    type: "input_image";
    image_url: string;
};
type CodexOutputText = {
    type: "output_text";
    text: string;
};
type CodexMessageItem = {
    type: "message";
    role: "user" | "assistant";
    content: Array<CodexInputText | CodexInputImage | CodexOutputText>;
};
type CodexReasoningItem = {
    type: "reasoning";
    id?: string;
    summary: Array<{
        type: "summary_text";
        text: string;
    }>;
    encrypted_content?: string | null;
};
type CodexFunctionCallItem = {
    type: "function_call";
    name: string;
    arguments: string;
    call_id: string;
};
type CodexFunctionCallOutputItem = {
    type: "function_call_output";
    call_id: string;
    output: string;
};
type CodexResponseItem = CodexMessageItem | CodexReasoningItem | CodexFunctionCallItem | CodexFunctionCallOutputItem;
/**
 * Walk canonical blocks and produce a Codex-native ResponseItem sequence.
 * Each canonical block maps to zero or one ResponseItems; order is preserved.
 */
declare function canonicalToCodexResponseItems(blocks: CanonicalBlock[], sessionId: string): CodexResponseItem[];

export { type CodexResponseItem, canonicalToCodexResponseItems };
