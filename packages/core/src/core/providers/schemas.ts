/**
 * Zod schemas for SNA provider types.
 *
 * Serves as the single source of truth for provider-layer validation.
 * Imported by both the HTTP routes (transform HTTP input → SpawnOptions)
 * and the runtime pool (validate RuntimeConfig before pooling).
 *
 * Two-layer discipline:
 *   Layer 1 (HTTP boundary): openapi-schemas.ts validates *incoming* HTTP requests.
 *   Layer 2 (Provider boundary): this file validates *internal* provider contracts.
 *   Mismatches between the two are caught at compile time (type alignment)
 *   and at runtime (Zod parse).
 */

import { z } from "zod";

// ── Shared enums (mirrors openapi-schemas.ts for internal use) ────────

export const sessionStateSchema = z.enum(["idle", "processing", "waiting", "permission"]);
export const agentStatusSchema = z.enum(["idle", "busy", "disconnected"]);

// ── AgentEvent schema ─────────────────────────────────────────────────

export const AgentEventSchema = z.object({
  type: z.enum([
    "init",
    "thinking",
    "thinking_delta",
    "text_delta",
    "assistant_delta",
    "assistant",
    "tool_use",
    "tool_result",
    "permission_needed",
    "milestone",
    "user_message",
    "interrupted",
    "error",
    "complete",
  ]),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  delta: z.string().optional(),
  index: z.number().optional(),
  timestamp: z.number(),
});

// ── ContentBlock schema ───────────────────────────────────────────────

export const ContentBlockSchema: z.ZodType<
  { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), source: z.object({ type: z.literal("base64"), media_type: z.string(), data: z.string() }) }),
]);

// ── McpServerConfig schema ────────────────────────────────────────────

export const McpServerConfigSchema: z.ZodType<
  { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers?: Record<string, string> }
> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("stdio").optional(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
  }),
]);
Object.assign(McpServerConfigSchema, { _type: "McpServerConfig" });

// ── SpawnOptions schema ───────────────────────────────────────────────

/**
 * Zod schema for SpawnOptions — the internal contract between
 * SessionManager and AgentProvider.
 *
 * This schema is the bridge between HTTP input (validated by
 * openapi-schemas.ts) and provider execution. If a field exists
 * in both layers, they must use the same schema definition.
 */
export const SpawnOptionsSchema = z.object({
  cwd: z.string(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan"]).optional(),
  env: z.record(z.string(), z.string()).optional(),

  // Common options
  configDir: z.string().optional(),
  resumeSessionId: z.string().optional(),
  systemPrompt: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
  history: z.array(z.any()).optional(),

  // Provider-specific options
  providerOptions: z.record(z.string(), z.unknown()).optional(),

  // Legacy
  extraArgs: z.array(z.string()).optional(),
});

// ── RuntimeConfig schema ──────────────────────────────────────────────

/**
 * Configuration that determines runtime pool keying.
 * Sessions with the same RuntimeConfig share a runtime handle
 * (daemon processes, app-server pools, etc.).
 */
export const RuntimeConfigSchema = z.object({
  provider: z.string(),
  cwd: z.string(),
  configDir: z.string().optional(),
  model: z.string().optional(),
  mcpConfigHash: z.string().optional(),
  settingsHash: z.string().optional(),
  permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan"]).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

// ── RuntimeHandle schema ──────────────────────────────────────────────

/**
 * Zod schema for RuntimeHandle — the global runtime resource
 * returned by prepareRuntime().
 */
export const RuntimeHandleSchema = z.object({
  provider: z.string(),
  ready: z.boolean(),
  daemon: z.unknown().optional(), // ChildProcess | undefined
  dispose: z.any().optional(), // () => void
});

// ── AgentProvider interface schema ────────────────────────────────────

/**
 * Zod schema for AgentProvider — the provider contract.
 * Used for runtime validation of provider registration.
 */
export const AgentProviderSchema = z.object({
  name: z.string(),
  isAvailable: z.any(), // function — runtime validated
  supportsRuntimePooling: z.boolean().optional(),
  prepareRuntime: z.any().optional(), // function — runtime validated
  spawn: z.any(), // function — runtime validated
  complete: z.any(), // function — runtime validated
});

// ── CompleteOptions schema ────────────────────────────────────────────

export const CompleteOptionsSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  extraArgs: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
});

// ── CompletionResult schema ───────────────────────────────────────────

export const CompletionResultSchema = z.object({
  text: z.string(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreationTokens: z.number(),
  }),
  costUsd: z.number(),
  durationMs: z.number(),
  durationApiMs: z.number(),
  model: z.string(),
});

// ── SpawnOptions → RuntimeConfig helper ───────────────────────────────

/**
 * Derive a RuntimeConfig from SpawnOptions for pool keying.
 * Only fields that affect the global runtime (daemon, app-server)
 * are included — per-session fields like prompt, history, etc. are excluded.
 */
export function spawnOptionsToRuntimeConfig(opts: z.infer<typeof SpawnOptionsSchema>): z.infer<typeof RuntimeConfigSchema> {
  const mcpHash = opts.mcpServers
    ? JSON.stringify(opts.mcpServers, Object.keys(opts.mcpServers).sort())
    : undefined;

  // Build a settings hash from providerOptions (excluding volatile fields)
  const settingsHash = opts.providerOptions
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(opts.providerOptions).filter(([k]) => k !== "settings"),
        ),
      )
    : undefined;

  return {
    provider: "unknown", // caller must set
    cwd: opts.cwd,
    configDir: opts.configDir,
    model: opts.model,
    mcpConfigHash: mcpHash,
    settingsHash,
    permissionMode: opts.permissionMode,
    providerOptions: opts.providerOptions,
    env: opts.env,
  };
}
