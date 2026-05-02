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
import { resolveCodexCli } from "./providers/codex.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../config.js";
import { traceCompletion } from "../lib/langfuse-tracer.js";

export interface CompletionOptions {
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
  const providerName = opts.provider ?? getConfig().defaultProvider;
  if (providerName === "codex") {
    return completionCodex(opts);
  }
  // "omlx" uses Claude Code CLI with oMLX as LLM backend
  return completionClaudeCode(opts);
}

// ── Claude Code completion ──────────────────────────────────────────────────

function completionClaudeCode(opts: CompletionOptions): Promise<CompletionResult> {
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

  logger.log("agent", `completion: ${label} provider=claude-code model=${model ?? "default"} prompt="${opts.prompt.slice(0, 60)}..."`);

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

// ── Codex completion ────────────────────────────────────────────────────────

/**
 * JSONL event types from `codex exec --json`.
 */
interface CodexThreadEvent {
  type: string;
  thread_id?: string;
  item?: {
    type: string;
    text?: string;
    id?: string;
  };
  usage?: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
  error?: { message: string };
}

function completionCodex(opts: CompletionOptions): Promise<CompletionResult> {
  const cwd = opts.cwd ?? process.cwd();
  const resolved = resolveCodexCli();
  const codexPath = resolved.path;

  const args = ["exec", "--json", "--ephemeral", "--full-auto"];

  // Only pass model if explicitly provided — config.model is typically a Claude model
  // which Codex doesn't support. Codex uses its own default (gpt-5.4 etc).
  if (opts.model) args.push("--model", opts.model);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  // System prompt via -c config override (native Codex support)
  // Both map to developer_instructions — Codex's effective instruction channel for exec mode.
  // systemPrompt takes precedence; appendSystemPrompt is concatenated after.
  const instructions = [opts.systemPrompt, opts.appendSystemPrompt].filter(Boolean).join("\n\n");
  if (instructions) {
    args.push("-c", `developer_instructions=${JSON.stringify(instructions)}`);
  }

  const prompt = opts.prompt;

  // Prompt as positional argument
  args.push(prompt);

  const cleanEnv = { ...process.env, ...opts.env } as Record<string, string>;
  const codexDir = codexPath.includes("/") ? codexPath.slice(0, codexPath.lastIndexOf("/")) : "";
  if (codexDir && codexDir !== ".") {
    cleanEnv.PATH = `${codexDir}:${cleanEnv.PATH ?? ""}`;
  }

  const label = opts.label ?? "completion";
  const timeout = opts.timeout ?? 60_000;

  const model = opts.model ?? "codex-default";
  logger.log("agent", `completion: ${label} provider=codex model=${model} prompt="${opts.prompt.slice(0, 60)}..."`);

  const trace = traceCompletion({ label, model, input: opts.prompt });
  const startTime = Date.now();

  return new Promise<CompletionResult>((resolve, reject) => {
    const proc = spawn(codexPath, args, {
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

    // Prompt is passed as positional argument, close stdin immediately
    proc.stdin!.end();

    proc.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      // Parse JSONL events
      const lines = stdout.trim().split("\n").filter(l => l.trim());
      const events: CodexThreadEvent[] = [];
      for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch { /* skip non-JSON */ }
      }

      // Extract final agent_message text
      let text = "";
      for (const evt of events) {
        if (evt.type === "item.completed" && evt.item?.type === "agent_message") {
          text = evt.item.text ?? "";
        }
      }

      // Extract usage from turn.completed
      let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
      for (const evt of events) {
        if (evt.type === "turn.completed" && evt.usage) {
          usage = evt.usage;
        }
      }

      // Check for errors
      const errorEvent = events.find(e => e.type === "turn.failed" || e.type === "error");
      if (errorEvent) {
        const err = new Error(`completion error: ${errorEvent.error?.message ?? "unknown"}`);
        trace?.error(err);
        reject(err);
        return;
      }

      if (!text && code !== 0) {
        const err = new Error(`completion: codex exited with code ${code}: ${stderr.slice(0, 200)}`);
        trace?.error(err);
        reject(err);
        return;
      }

      const result: CompletionResult = {
        text,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cached_input_tokens,
          cacheCreationTokens: 0,
        },
        costUsd: 0, // Codex doesn't return cost
        durationMs,
        durationApiMs: durationMs, // no separate API duration
        model: model ?? "codex",
      };

      logger.log("agent", `completion done: ${label} ${result.durationMs}ms in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);

      trace?.end(result);
      resolve(result);
    });
  });
}
