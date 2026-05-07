export type {
  AgentProvider,
  AgentProcess,
  AgentEvent,
  SpawnOptions,
  CompleteOptions,
  CompletionResult,
  ListModelsConfig,
  ListModelsResult,
  RuntimeModelInfo,
} from "./types.js";
export { RuntimePool } from "./runtime.js";
export {
  SpawnOptionsSchema,
  RuntimeConfigSchema,
  RuntimeHandleSchema,
} from "./schemas.js";
export { ClaudeCodeProvider } from "./claude-code.js";
export { CodexProvider } from "./codex.js";
export { OpenCodeProvider } from "./opencode.js";

import type { AgentProvider } from "./types.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { OpenCodeProvider } from "./opencode.js";
import { RuntimePool } from "./runtime.js";

const providers: Record<string, AgentProvider> = {
  "claude-code": new ClaudeCodeProvider(),
  "codex": new CodexProvider(),
  "opencode": new OpenCodeProvider(),
  "omlx": new ClaudeCodeProvider(),
};

let _runtimePool: RuntimePool | null = null;

/**
 * Get or create the global RuntimePool singleton.
 * Manages daemon-style processes for providers that support pooling.
 */
export function getRuntimePool(): RuntimePool {
  if (!_runtimePool) {
    _runtimePool = new RuntimePool();
  }
  return _runtimePool;
}

/**
 * Get a registered provider by name.
 * @throws if provider not found
 */
export function getProvider(name: string = "claude-code"): AgentProvider {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown agent provider: ${name}`);
  return provider;
}

/** Register a custom provider. */
export function registerProvider(provider: AgentProvider): void {
  providers[provider.name] = provider;
}
