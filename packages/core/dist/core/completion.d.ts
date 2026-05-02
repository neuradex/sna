/**
 * completion.ts — Lightweight one-shot LLM completion.
 *
 * Spawns `claude -p --output-format json` and returns the result.
 * No session management, no event streaming, no stdin interaction.
 *
 * @example
 * const { completion } = await import("sna");
 * const result = await completion({
 *   prompt: "Summarize this text",
 *   model: "claude-haiku-4-5-20251001",
 *   label: "summarizer",
 * });
 * // result.text, result.usage, result.costUsd, result.durationMs
 */
interface CompletionOptions {
    /** The prompt to send. */
    prompt: string;
    /** Provider: "claude-code" (default), "codex", or "omlx". */
    provider?: "claude-code" | "codex";
    /** Model to use. Falls back to config.model. */
    model?: string;
    /** System prompt override. */
    systemPrompt?: string;
    /** Append to the default system prompt. */
    appendSystemPrompt?: string;
    /** Working directory for the claude process. */
    cwd?: string;
    /** Extra environment variables. */
    env?: Record<string, string>;
    /** Additional CLI flags (e.g. --max-tokens). */
    extraArgs?: string[];
    /** Label for Langfuse tracing. Default: "completion". */
    label?: string;
    /** Timeout in milliseconds. Default: 60000 (60s). */
    timeout?: number;
}
interface CompletionResult {
    /** The response text. */
    text: string;
    /** Token usage breakdown. */
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
    };
    /** Total cost in USD. */
    costUsd: number;
    /** Total duration in milliseconds. */
    durationMs: number;
    /** API call duration in milliseconds. */
    durationApiMs: number;
    /** Model that was actually used. */
    model: string;
}
declare function completion(opts: CompletionOptions): Promise<CompletionResult>;

export { type CompletionOptions, type CompletionResult, completion };
