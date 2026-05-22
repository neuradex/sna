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
export { RuntimePool, getRuntimePool } from "./runtime.js";
export {
  SpawnOptionsSchema,
  RuntimeConfigSchema,
  RuntimeHandleSchema,
} from "./schemas.js";
export { ClaudeCodeProvider } from "./claude-code.js";
export { CodexProvider } from "./codex.js";
export { OpenCodeProvider } from "./opencode.js";
export { GrokProvider } from "./grok.js";
export { CursorProvider } from "./cursor.js";
export { spawnWithPool } from "./spawn-helper.js";

import type { AgentProvider } from "./types.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { OpenCodeProvider } from "./opencode.js";
import { GrokProvider } from "./grok.js";
import { CursorProvider } from "./cursor.js";

export interface AgentProviderCatalogEntry {
  id: string;
  label: string;
  available: boolean;
  supportsRuntimePooling: boolean;
  supportsCwdPerThread: boolean;
  modelListing: boolean;
}

const providers: Record<string, AgentProvider> = {
  "claude-code": new ClaudeCodeProvider(),
  "codex": new CodexProvider(),
  "opencode": new OpenCodeProvider(),
  "grok": new GrokProvider(),
  "cursor": new CursorProvider(),
};

const builtinProviderIds = ["claude-code", "codex", "opencode", "grok", "cursor"] as const;

const providerLabels: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  grok: "Grok Build",
  cursor: "Cursor",
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

/** List SNA-supported agent providers for registration UIs. */
export async function listProviders(): Promise<AgentProviderCatalogEntry[]> {
  return Promise.all(
    builtinProviderIds.map(async (id) => {
      const provider = providers[id];
      const available = await provider.isAvailable().catch(() => false);
      return {
        id,
        label: providerLabels[id] ?? id,
        available,
        supportsRuntimePooling: provider.supportsRuntimePooling,
        supportsCwdPerThread: provider.supportsCwdPerThread === true,
        modelListing: typeof provider.listModels === "function",
      };
    }),
  );
}
