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
    | "tool_result"     // tool returned a result
    | "permission_needed" // agent needs user approval
    | "milestone"       // skill progress milestone
    | "user_message"    // user message sent (for multi-client sync)
    | "interrupted"     // user interrupted current turn
    | "error"           // error occurred
    | "complete";       // agent finished
  message?: string;
  data?: Record<string, unknown>;
  /** Streaming text delta (for assistant_delta events only) */
  delta?: string;
  /** Content block index (for assistant_delta events only) */
  index?: number;
  timestamp: number;
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
   * Respond to a permission request from the agent.
   * Used by providers with bidirectional approval flow (e.g. Codex JSON-RPC).
   * No-op for providers that handle permissions externally (e.g. Claude Code hooks).
   */
  respondToPermission?(requestId: string, approved: boolean): void;
  /** Kill the agent process. */
  kill(): void;
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
   *   omlxBaseUrl?: string           — route ANTHROPIC_BASE_URL to oMLX local LLM
   * Codex: { config?: Record<string, string>, profile?: string }
   */
  providerOptions?: Record<string, unknown>;

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
 */
export interface AgentProvider {
  readonly name: string;
  /** Check if this provider's CLI is available on the system. */
  isAvailable(): Promise<boolean>;
  /** Spawn a new agent session. */
  spawn(options: SpawnOptions): AgentProcess;
}
