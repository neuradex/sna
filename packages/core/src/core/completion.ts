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

import { logger } from "../lib/logger.js";
import { getConfig } from "../config.js";
import { traceCompletion } from "../lib/langfuse-tracer.js";
import { getProvider } from "./providers/index.js";
import type { CompletionResult } from "./providers/types.js";

export interface CompletionOptions {
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
  /**
   * Reasoning effort / thinking strength (0..5). See
   * {@link import("./providers/types.js").SpawnOptions.reasoningLevel}
   * for the per-provider translation table.
   */
  reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;
  /** Provider-specific options (e.g. `{ omlxBaseUrl: "http://..." }`). */
  providerOptions?: Record<string, unknown>;
}

/** Re-export the canonical result type from the provider layer. */
export type { CompletionResult } from "./providers/types.js";

/**
 * Run a one-shot completion through the resolved provider.
 */
export async function completion(opts: CompletionOptions): Promise<CompletionResult> {
  const providerName = opts.provider ?? getConfig().defaultProvider;
  const model = opts.model ?? getConfig().model;
  const label = opts.label ?? "completion";

  logger.log("agent", `completion: ${label} provider=${providerName} model=${model ?? "default"} prompt="${opts.prompt.slice(0, 60)}..."`);

  const trace = traceCompletion({ label, model, input: opts.prompt });

  try {
    const provider = getProvider(providerName);
    const result = await provider.complete({
      prompt: opts.prompt,
      model,
      systemPrompt: opts.systemPrompt,
      appendSystemPrompt: opts.appendSystemPrompt,
      cwd: opts.cwd,
      env: opts.env,
      extraArgs: opts.extraArgs,
      timeout: opts.timeout,
      reasoningLevel: opts.reasoningLevel,
      providerOptions: opts.providerOptions,
    });

    logger.log("agent", `completion done: ${label} ${result.durationMs}ms cost=$${result.costUsd.toFixed(4)} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);

    trace?.end(result);
    return result;
  } catch (err) {
    trace?.error(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
