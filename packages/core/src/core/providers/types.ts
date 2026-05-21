/**
 * Normalized event type emitted by all agent providers.
 *
 * Providers translate their native event format (Claude Code stream-json,
 * Codex JSONL, etc.) into these common types.
 */
export interface AgentEvent {
  type:
    | "init"            // session initialized
    | "thinking"        // model is reasoning (extended thinking block, complete)
    | "thinking_delta"  // streaming thinking chunk (partial, before final thinking event)
    | "text_delta"      // streaming text from assistant (legacy alias)
    | "assistant_delta" // streaming text delta (real-time, before final assistant event)
    | "assistant"       // full assistant message (complete, backward-compatible)
    | "tool_use"        // agent is calling a tool
    | "tool_use_delta"  // streaming partial tool input (Claude Code only — Codex/OpenCode wire formats do not surface this)
    | "tool_result"     // tool returned a result
    | "permission_needed" // agent needs user approval
    | "milestone"       // skill progress milestone
    | "user_message"    // user message sent (for multi-client sync)
    | "interrupted"     // user interrupted current turn
    | "error"           // error occurred
    | "complete";       // agent finished
  message?: string;
  data?: Record<string, unknown>;
  /**
   * Streaming text delta. Used by:
   *   - assistant_delta : token text from the assistant
   *   - tool_use_delta  : partial JSON fragment for the tool call's input
   */
  delta?: string;
  /** Content block index (for assistant_delta and tool_use_delta events) */
  index?: number;
  timestamp: number;
}

/**
 * Mutable subset of SessionConfig that can be PATCH-applied to an alive agent.
 *
 * Each field has a per-provider dispatch strategy: Codex applies model /
 * permissionMode / cwd via per-turn overrides on the next `turn/start`;
 * Claude Code applies model / permissionMode via control_request but cannot
 * change cwd in-place; OpenCode applies model / permissionMode on the next
 * prompt; ACP applies SNA-side permission gate changes in-place. Fields that
 * cannot be handled in-place are returned as leftover so the caller can drive
 * a respawn.
 *
 * Defined here (and not anchored on `SessionConfig` directly) to keep the
 * providers layer independent of session-manager.
 */
export interface SessionPatch {
  cwd?: string;
  model?: string;
  permissionMode?: string;
  // Future: provider, systemPrompt, mcpServers, allowedTools, ...
}

/**
 * A running agent process. Wraps a child_process with typed event handlers.
 */
export interface AgentProcess {
  /** Send a user message to the agent's stdin. Accepts string or content blocks (text + images). */
  send(input: string | ContentBlock[]): void;
  /** Interrupt the current turn. Process stays alive. */
  interrupt(): void;
  /** Change model at runtime via control message. No restart needed. */
  setModel(model: string): void;
  /** Change permission mode at runtime via control message. No restart needed. */
  setPermissionMode(mode: string): void;
  /**
   * Try to apply a config patch in-place on the alive process. Returns the
   * subset of fields the provider could NOT handle without a respawn — the
   * caller is expected to merge those into the next spawn config (with
   * history replay) to complete the patch.
   *
   * Implementations: Codex applies all currently-defined fields in-place via
   * next turn/start overrides. Claude Code applies model / permissionMode via
   * control_request but returns `cwd`. OpenCode applies model /
   * permissionMode as next-prompt overrides and returns `cwd`. ACP runtimes
   * apply SNA-side permissionMode gates in-place and return model / cwd.
   */
  applyPatch(patch: SessionPatch): SessionPatch;
  /**
   * Respond to a permission request from the agent.
   * Used by providers with bidirectional approval flow (e.g. Codex JSON-RPC).
   * No-op for providers that handle permissions externally (e.g. Claude Code hooks).
   */
  respondToPermission?(requestId: string, approved: boolean): void;
  /** Kill the agent process. */
  kill(): void;
  /**
   * Close only the active thread on a pooled daemon (does NOT kill the daemon).
   * No-op for non-pooled providers (same behavior as kill()).
   */
  closeThread(): void;
  /** Whether the process is still running. */
  readonly alive: boolean;
  /** OS process ID. */
  readonly pid: number | null;
  /** Session ID assigned by the provider. */
  readonly sessionId: string | null;

  on(event: "event", handler: (e: AgentEvent) => void): void;
  on(event: "exit", handler: (code: number | null) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  off(event: string, handler: Function): void;
}

/**
 * Options for spawning an agent session.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

/**
 * MCP server definition — common format for all providers.
 * Supports stdio (command+args) and HTTP (url) servers.
 */
export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers?: Record<string, string> };

export interface SpawnOptions {
  cwd: string;
  prompt?: string;
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  env?: Record<string, string>;

  // ── Common options (provider-agnostic) ─────────────────────────────

  /**
   * Override the agent config directory for this session.
   * Claude Code: CLAUDE_CONFIG_DIR
   * Codex: CODEX_HOME
   */
  configDir?: string;

  /**
   * Native session ID to resume (provider-specific).
   * Claude Code: CC session ID → --resume <id>
   * Codex: thread ID → thread/resume API
   */
  resumeSessionId?: string;

  /**
   * Replace the base system prompt.
   * Claude Code: --system-prompt
   * Codex: baseInstructions on thread/start
   */
  systemPrompt?: string;

  /**
   * Append to the system prompt (additive, for project-specific rules).
   * Claude Code: --append-system-prompt
   * Codex: developerInstructions on thread/start
   */
  appendSystemPrompt?: string;

  /**
   * Restrict the agent to only use these tools. Others are blocked.
   * Claude Code: --allowedTools
   * Codex: PreToolUse hook that denies unlisted tools
   */
  allowedTools?: string[];

  /**
   * Block specific tools. All others are allowed.
   * Claude Code: --disallowedTools
   * Codex: PreToolUse hook that denies listed tools
   * If both allowedTools and disallowedTools are set, allowedTools takes precedence.
   */
  disallowedTools?: string[];

  /**
   * MCP servers to make available to the agent.
   * Claude Code: --mcp-config JSON
   * Codex: written to CODEX_HOME/config.toml [mcp_servers.*]
   */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Canonical conversation history to seed the agent with before the first prompt.
   * The provider's own history adapter converts these blocks into the native
   * wire format (Claude JSONL resume file, Codex thread/resume(history=...)).
   */
  history?: import("../../history/types.js").CanonicalBlock[];

  // ── Provider-specific options ──────────────────────────────────────

  /**
   * Provider-specific options passed through to the provider.
   * Not interpreted by the framework — each provider defines its own shape.
   *
   * Claude Code:
   *   settings?: object              — merged into the --settings JSON (hooks, permissions, etc.)
   *   settingSources?: string[]      — --setting-sources (pass [""] to disable CLAUDE.md/skills/memory)
   *   strictMcpConfig?: boolean      — --strict-mcp-config
   *   maxTurns?: number              — --max-turns
   *   disableSlashCommands?: boolean — --disable-slash-commands
   * Codex:
   *   config?: Record<string, string> — extra `-c key=value` config overrides for `codex app-server`
   *                                     and `codex exec`; the object contributes to the runtime pool key
   *   profile?: string                — config.toml profile name passed as `--profile` to app-server
   *                                     and exec; also contributes to the runtime pool key
   *   serviceTier?: string            — OpenAI request-priority tier (Codex `/fast` slash command
   *                                     equivalent). Common values: "priority" (fastest, premium
   *                                     billing — mirrors `/fast`), "flex" (cheaper, slower),
   *                                     "batch" (lowest priority). The pool path threads this
   *                                     into `turn/start.serviceTier`; the ephemeral `codex exec`
   *                                     path passes `-c service_tier=<value>`.
   *                                     INTENTIONALLY Codex-only: Claude Code's `/fast` is a
   *                                     different (more expensive) MODEL variant, not a routing
   *                                     tier — auto-mapping there would invite surprise spending.
   *                                     For Claude, pick a faster variant via `model` directly.
   * OpenCode:
   *   serverUrl?: string             — route to a pre-existing `opencode serve` instead of spawning one
   *   modelProviderId?: string       — providerID half of the OpenCode model selector ({providerID, modelID})
   *   agent?: string                 — OpenCode agent name (build/plan/etc.) for the prompt
   *   opencodeConfigHash?: string    — hash of opencode config overrides; different hashes get different daemons
   *   logLevel?: string              — passed through to `opencode serve --log-level`
   */
  providerOptions?: Record<string, unknown>;

  /**
   * Reasoning effort / thinking strength. Provider-agnostic 0..5 scale,
   * where 0 is the lightest reasoning the provider supports and 5 is the
   * heaviest. Each provider adapter translates this to its native knob:
   *
   *   level | Claude Code (`--effort`) | Codex (`model_reasoning_effort` / `turn/start.effort`)
   *   ------+--------------------------+-------------------------------------------------------
   *     0   | low                      | none
   *     1   | low      (collapse)      | minimal
   *     2   | medium                   | low
   *     3   | high                     | medium
   *     4   | xhigh                    | high
   *     5   | max                      | xhigh
   *
   * Omit to inherit the provider's own default (`~/.codex/config.toml`'s
   * `model_reasoning_effort`, Claude Code's `settings.json` `effortLevel`,
   * etc.). OpenCode currently ignores this field.
   *
   * Note on Codex `minimal`: the model rejects `minimal` when certain
   * built-in tools (image_gen, web_search) are enabled in your codex
   * config. Use level 2 or higher in that case.
   */
  reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;

  /**
   * Additional CLI flags passed directly to the agent binary.
   * Prefer typed fields above; use this only for flags not yet abstracted.
   * @deprecated Prefer systemPrompt, appendSystemPrompt, resumeSessionId etc.
   */
  extraArgs?: string[];
}

/**
 * Agent provider interface. Each backend (Claude Code, Codex, etc.)
 * implements this to provide a unified spawn → events → send API.
 *
 * Providers that use daemon-style runtimes (Codex, OpenCode) must
 * implement `prepareRuntime` and set `supportsRuntimePooling = true`.
 * Stateless providers (Claude Code) set `supportsRuntimePooling = false`.
 */
export interface AgentProvider {
  readonly name: string;
  /** Check if this provider's CLI is available on the system. */
  isAvailable(): Promise<boolean>;
  /** Whether this provider uses a shared global runtime (daemon pool). */
  readonly supportsRuntimePooling: boolean;
  /**
   * Whether `spawn(options)` can pass a per-thread/per-turn `cwd` to the
   * daemon — i.e. one shared daemon can host sessions operating on different
   * working directories. When true, RuntimePool drops `cwd` from its key so
   * cross-cwd sessions reuse the same pooled daemon.
   *
   * Providers that bind cwd at daemon spawn (or have no daemon) leave this
   * false / undefined.
   */
  readonly supportsCwdPerThread?: boolean;
  /**
   * Prepare (or reuse) a global runtime for this provider.
   * Called once per unique runtime config. Returns a handle that
   * can be shared across sessions. Null for stateless providers.
   */
  prepareRuntime?(config: import("./runtime.js").RuntimeConfig): Promise<import("./runtime.js").RuntimeHandle>;
  /**
   * Spawn an agent session. For pooled providers, pass `runtimeHandle`
   * (from `prepareRuntime`) to start a thread on the shared daemon;
   * omit it for stateless providers or legacy non-pooled spawn.
   */
  spawn(options: SpawnOptions, runtimeHandle?: import("./runtime.js").RuntimeHandle): AgentProcess;
  /** One-shot completion (no session, no streaming). */
  complete(options: CompleteOptions): Promise<CompletionResult>;
  /**
   * List models available through this provider.
   *
   * The returned IDs are the slugs that should be passed back to `spawn`'s
   * `model` field. Some providers expose a static curated catalog
   * (claude-code, codex), others probe a live source (opencode CLI, Cursor
   * CLI). Callers must treat results as a hint — model availability can
   * change between calls.
   *
   * Optional: providers without a meaningful catalog can omit this.
   */
  listModels?(config?: ListModelsConfig): Promise<ListModelsResult>;
}

// ── Model listing ────────────────────────────────────────────────────────────

/**
 * Caller-supplied configuration for listModels.
 *
 * Most fields are only used by specific providers. OpenCode honors `cliPath`
 * to override the default `opencode` binary.
 */
export interface ListModelsConfig {
  /** Override CLI binary path (opencode). */
  cliPath?: string;
  /** Bypass the in-memory cache. */
  refresh?: boolean;
}

/** Single model entry returned by listModels. */
export interface RuntimeModelInfo {
  /** Slug to pass back to spawn's `model` field. */
  id: string;
  /** Human-readable label for UI. */
  label: string;
  /**
   * Inference backend family for grouping/attribution: "anthropic", "openai",
   * "google", "oss", or other provider-specific identifier.
   */
  provider: string;
  /** Where this entry came from — for cache TTL / staleness reasoning. */
  source: "static" | "api" | "cli";
  /** Token context window when known. */
  contextWindow?: number;
  /** Mark deprecated entries so UI can de-emphasize them. */
  deprecated?: boolean;
  /** Human-readable annotation ("legacy alias", "preview", etc.). */
  notes?: string;
}

/** Aggregate result of a listModels call. */
export interface ListModelsResult {
  models: RuntimeModelInfo[];
  /** Dominant source category for the result set. */
  source: "static" | "api" | "cli" | "mixed";
  /** Epoch ms when this result was produced (or pulled from cache). */
  fetchedAt: number;
  /**
   * Set when the call could not fully populate the list — e.g. opencode CLI
   * not installed or provider probing failed. `models` may still be populated
   * with a partial / fallback result.
   */
  error?: string;
}

// ── One-shot completion types ────────────────────────────────────────────────

/** Options for a one-shot completion call. */
export interface CompleteOptions {
  /** The prompt to send. */
  prompt: string;
  /** Model to use. */
  model?: string;
  /** System prompt override. */
  systemPrompt?: string;
  /** Append to the default system prompt. */
  appendSystemPrompt?: string;
  /** Working directory for the process. */
  cwd?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
  /** Additional CLI flags. */
  extraArgs?: string[];
  /** Timeout in milliseconds. Default: 60000. */
  timeout?: number;
  /**
   * Reasoning effort / thinking strength (0..5, lightest to heaviest).
   * See {@link SpawnOptions.reasoningLevel} for the full mapping table.
   */
  reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;
  /**
   * Streaming callback. When set, each assistant-text chunk is delivered
   * to the callback as soon as the provider emits it. The Promise still
   * resolves to the final {@link CompletionResult} with the concatenated
   * text + usage; the callback is purely a side channel for streaming UX
   * (autocomplete, typewriter rendering, etc.).
   *
   * Provider notes:
   *   - claude-code: streamed via `--include-partial-messages` + JSONL parse
   *   - codex (pool): forwarded from `item/agentMessage/delta` notifications
   *   - codex (ephemeral): parsed from `codex exec --json` stdout stream
   *   - opencode: streamed through `session.promptAsync` + SSE events when
   *               the callback is present; otherwise uses the sync SDK call
   *
   * Callbacks fire from the same Node.js microtask as the underlying
   * stream — keep them cheap. Throwing inside the callback aborts the
   * completion with the thrown error.
   */
  onDelta?: (delta: string) => void;
  /** Provider-specific options. */
  providerOptions?: Record<string, unknown>;
}

/** Normalized result from a one-shot completion. */
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
  /** Total cost in USD (0 if provider doesn't report cost). */
  costUsd: number;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** API call duration in milliseconds. */
  durationApiMs: number;
  /** Model that was actually used. */
  model: string;
}
