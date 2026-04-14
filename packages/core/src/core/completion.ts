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

import { spawn } from "child_process";
import { resolveClaudeCli } from "./providers/claude-code.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../config.js";
import { traceCompletion } from "../lib/langfuse-tracer.js";

export interface CompletionOptions {
  /** The prompt to send. */
  prompt: string;
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

export interface CompletionResult {
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

/**
 * Raw JSON shape returned by `claude -p --output-format json`.
 */
interface ClaudeJsonResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  duration_ms: number;
  duration_api_ms: number;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
  }>;
}

export async function completion(opts: CompletionOptions): Promise<CompletionResult> {
  const cwd = opts.cwd ?? process.cwd();
  const resolved = resolveClaudeCli({ cacheDir: undefined });
  const claudeParts = resolved.path.split(/\s+/);
  const claudePath = claudeParts[0]!;
  const claudePrefix = claudeParts.slice(1);

  const args = [
    ...claudePrefix,
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
  ];

  const model = opts.model ?? getConfig().model;
  if (model) args.push("--model", model);
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  // Prompt as the final positional argument
  args.push(opts.prompt);

  const cleanEnv = { ...process.env, ...opts.env } as Record<string, string>;
  // Route through API proxy when Langfuse tracing is active
  const proxyPort = getConfig().apiProxyPort;
  if (proxyPort) {
    cleanEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  }
  // Clean up inherited Claude Code env vars
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  const label = opts.label ?? "completion";
  const timeout = opts.timeout ?? 60_000;

  logger.log("agent", `completion: ${label} model=${model ?? "default"} prompt="${opts.prompt.slice(0, 60)}..."`);

  // Langfuse trace (no-op if not initialized)
  const trace = traceCompletion({ label, model, input: opts.prompt });

  return new Promise<CompletionResult>((resolve, reject) => {
    const proc = spawn(claudePath, args, {
      cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill();
      const err = new Error(`completion timed out after ${timeout}ms`);
      trace?.error(err);
      reject(err);
    }, timeout);

    proc.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => {
      clearTimeout(timer);
      trace?.error(err);
      reject(new Error(`completion spawn error: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      let parsed: ClaudeJsonResult;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        const err = new Error(`completion: failed to parse JSON (code=${code}): ${stdout.slice(0, 200)} ${stderr.slice(0, 200)}`);
        trace?.error(err);
        reject(err);
        return;
      }

      if (parsed.is_error) {
        const err = new Error(`completion error: ${parsed.result}`);
        trace?.error(err);
        reject(err);
        return;
      }

      const modelKey = Object.keys(parsed.modelUsage)[0] ?? model ?? "unknown";

      const result: CompletionResult = {
        text: parsed.result,
        usage: {
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          cacheReadTokens: parsed.usage.cache_read_input_tokens,
          cacheCreationTokens: parsed.usage.cache_creation_input_tokens,
        },
        costUsd: parsed.total_cost_usd,
        durationMs: parsed.duration_ms,
        durationApiMs: parsed.duration_api_ms,
        model: modelKey,
      };

      logger.log("agent", `completion done: ${label} ${result.durationMs}ms cost=$${result.costUsd.toFixed(4)} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);

      trace?.end(result);
      resolve(result);
    });

    // Close stdin — prompt is passed as CLI argument
    proc.stdin!.end();
  });
}
