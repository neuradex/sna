import { CompletionResult } from './providers/types.js';
import '../history/types.js';
import '../db/schema.js';
import 'better-sqlite3';

/**
 * completion.ts — Lightweight one-shot LLM completion.
 *
 * Delegates to the provider's `complete()` method via the unified
 * AgentProvider interface.  Tracing and config resolution happen here;
 * provider-specific spawning and parsing live in each provider class.
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
    /** Provider name. Falls back to config.defaultProvider. */
    provider?: string;
    /** Model to use. Falls back to config.model. */
    model?: string;
    /** System prompt override. */
    systemPrompt?: string;
    /** Append to the default system prompt. */
    appendSystemPrompt?: string;
    /** Working directory for the process. */
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

/**
 * Run a one-shot completion through the resolved provider.
 */
declare function completion(opts: CompletionOptions): Promise<CompletionResult>;

export { type CompletionOptions, CompletionResult, completion };
