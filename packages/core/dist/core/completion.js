import { logger } from "../lib/logger.js";
import { getConfig } from "../config.js";
import { traceCompletion } from "../lib/langfuse-tracer.js";
import { getProvider } from "./providers/index.js";
async function completion(opts) {
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
      timeout: opts.timeout
    });
    logger.log("agent", `completion done: ${label} ${result.durationMs}ms cost=$${result.costUsd.toFixed(4)} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
    trace?.end(result);
    return result;
  } catch (err) {
    trace?.error(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
export {
  completion
};
