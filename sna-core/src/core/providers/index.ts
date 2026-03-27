export type { AgentProvider, AgentProcess, AgentEvent, SpawnOptions } from "./types.js";
export { ClaudeCodeProvider } from "./claude-code.js";
export { CodexProvider } from "./codex.js";

import type { AgentProvider } from "./types.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";

const providers: Record<string, AgentProvider> = {
  "claude-code": new ClaudeCodeProvider(),
  "codex": new CodexProvider(),
};

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
