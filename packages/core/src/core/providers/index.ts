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
import { execFileSync } from "node:child_process";
import { ClaudeCodeProvider, resolveClaudeCli } from "./claude-code.js";
import { CodexProvider, resolveCodexCli } from "./codex.js";
import { OpenCodeProvider, resolveOpenCodeCli } from "./opencode.js";
import { GrokProvider, resolveGrokPath } from "./grok.js";
import { CursorProvider, DEFAULT_CURSOR_COMMAND, resolveCursorPath } from "./cursor.js";

type DetectionSource = "env" | "cache" | "static" | "shell" | "fallback";

export interface AgentProviderDetection {
  detected: boolean;
  path: string;
  version?: string;
  source: DetectionSource;
  message?: string;
}

export interface AgentProviderCatalogEntry {
  id: string;
  label: string;
  available: boolean;
  supportsRuntimePooling: boolean;
  supportsCwdPerThread: boolean;
  modelListing: boolean;
  detection: AgentProviderDetection;
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

const staticCliPaths: Record<string, string[]> = {
  "grok": [
    `${process.env.HOME}/.local/bin/grok`,
    "/usr/local/bin/grok",
    "/opt/homebrew/bin/grok",
  ],
  "cursor": [
    `${process.env.HOME}/.local/bin/cursor-agent`,
    "/usr/local/bin/cursor-agent",
    "/opt/homebrew/bin/cursor-agent",
  ],
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
      const detection = detectProviderCli(id);
      return {
        id,
        label: providerLabels[id] ?? id,
        available: detection.detected,
        supportsRuntimePooling: provider.supportsRuntimePooling,
        supportsCwdPerThread: provider.supportsCwdPerThread === true,
        modelListing: typeof provider.listModels === "function",
        detection,
      };
    }),
  );
}

function detectProviderCli(id: typeof builtinProviderIds[number]): AgentProviderDetection {
  try {
    if (id === "claude-code") return normalizeResolverResult(resolveClaudeCli());
    if (id === "codex") return normalizeResolverResult(resolveCodexCli());
    if (id === "opencode") return normalizeResolverResult(resolveOpenCodeCli());
    if (id === "grok") return detectSimpleCli("grok", resolveGrokPath(), "SNA_GROK_COMMAND");
    return detectSimpleCli(DEFAULT_CURSOR_COMMAND, resolveCursorPath(), "SNA_CURSOR_COMMAND", "cursor");
  } catch (err) {
    return {
      detected: false,
      path: id,
      source: "fallback",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeResolverResult(result: { path: string; version?: string; source: DetectionSource }): AgentProviderDetection {
  return {
    detected: result.source !== "fallback" && Boolean(result.version),
    path: result.path,
    version: result.version,
    source: result.source,
    ...(result.source === "fallback" ? { message: "CLI not found" } : {}),
  };
}

function detectSimpleCli(
  commandName: "grok" | "cursor-agent",
  detectedPath: string,
  envVar: "SNA_GROK_COMMAND" | "SNA_CURSOR_COMMAND",
  providerId?: "grok" | "cursor",
): AgentProviderDetection {
  const key = providerId ?? (commandName === "grok" ? "grok" : "cursor");
  const source: DetectionSource = process.env[envVar]
    ? "env"
    : detectedPath === commandName
      ? "fallback"
      : staticCliPaths[key]?.includes(detectedPath)
        ? "static"
        : "shell";
  try {
    const out = execFileSync(detectedPath, ["--version"], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 5000,
    }).trim();
    const resolvedSource = source === "fallback" ? "shell" : source;
    return {
      detected: true,
      path: detectedPath,
      version: out.split("\n")[0]?.slice(0, 80),
      source: resolvedSource,
    };
  } catch (err) {
    return {
      detected: false,
      path: detectedPath,
      source,
      message: source === "fallback" ? "CLI not found" : err instanceof Error ? err.message : String(err),
    };
  }
}
