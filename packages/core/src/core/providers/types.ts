/**
 * Normalized event type emitted by all agent providers.
 *
 * Providers translate their native event format (Claude Code stream-json,
 * Codex JSONL, etc.) into these common types.
 */
export interface AgentEvent {
  type:
    | "init"            // session initialized
    | "thinking"        // model is reasoning (extended thinking block)
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
  /** Kill the agent process. */
  kill(): void;
  /** Whether the process is still running. */
  readonly alive: boolean;
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

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SpawnOptions {
  cwd: string;
  prompt?: string;
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  env?: Record<string, string>;
  /**
   * Conversation history to inject before the first prompt.
   * Written to stdin as NDJSON — Claude Code treats these as prior conversation turns.
   * Must alternate user→assistant. Assistant content is auto-wrapped in array format.
   */
  history?: HistoryMessage[];
  /** @internal Set by provider when history was injected via JSONL resume. */
  _historyViaResume?: boolean;
  /**
   * Additional CLI flags passed directly to the agent binary.
   * e.g. ["--system-prompt", "You are...", "--append-system-prompt", "Also...", "--mcp-config", "path"]
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
