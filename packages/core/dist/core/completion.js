import { spawn } from "child_process";
import { resolveClaudeCli } from "./providers/claude-code.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../config.js";
import { traceCompletion } from "../lib/langfuse-tracer.js";
async function completion(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const resolved = resolveClaudeCli({ cacheDir: void 0 });
  const claudeParts = resolved.path.split(/\s+/);
  const claudePath = claudeParts[0];
  const claudePrefix = claudeParts.slice(1);
  const args = [
    ...claudePrefix,
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence"
  ];
  const model = opts.model ?? getConfig().model;
  if (model) args.push("--model", model);
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  args.push(opts.prompt);
  const cleanEnv = { ...process.env, ...opts.env };
  const proxyPort = getConfig().apiProxyPort;
  if (proxyPort) {
    cleanEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  }
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
  const label = opts.label ?? "completion";
  const timeout = opts.timeout ?? 6e4;
  logger.log("agent", `completion: ${label} model=${model ?? "default"} prompt="${opts.prompt.slice(0, 60)}..."`);
  const trace = traceCompletion({ label, model, input: opts.prompt });
  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, args, {
      cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      const err = new Error(`completion timed out after ${timeout}ms`);
      trace?.error(err);
      reject(err);
    }, timeout);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      trace?.error(err);
      reject(new Error(`completion spawn error: ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      let parsed;
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
      const result = {
        text: parsed.result,
        usage: {
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          cacheReadTokens: parsed.usage.cache_read_input_tokens,
          cacheCreationTokens: parsed.usage.cache_creation_input_tokens
        },
        costUsd: parsed.total_cost_usd,
        durationMs: parsed.duration_ms,
        durationApiMs: parsed.duration_api_ms,
        model: modelKey
      };
      logger.log("agent", `completion done: ${label} ${result.durationMs}ms cost=$${result.costUsd.toFixed(4)} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
      trace?.end(result);
      resolve(result);
    });
    proc.stdin.end();
  });
}
export {
  completion
};
