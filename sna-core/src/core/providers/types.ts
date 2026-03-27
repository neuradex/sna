import type { ChildProcess } from "child_process";
import type { EventEmitter } from "events";

/**
 * Normalized event type emitted by all agent providers.
 *
 * Providers translate their native event format (Claude Code stream-json,
 * Codex JSONL, etc.) into these common types.
 */
export interface AgentEvent {
  type:
    | "init"          // session initialized
    | "thinking"      // model is reasoning (extended thinking block)
    | "text_delta"    // streaming text from assistant
    | "assistant"     // full assistant message
    | "tool_use"      // agent is calling a tool
    | "tool_result"   // tool returned a result
    | "permission_needed" // agent needs user approval
    | "milestone"     // skill progress milestone
    | "error"         // error occurred
    | "complete";     // agent finished
  message?: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

/**
 * A running agent process. Wraps a child_process with typed event handlers.
 */
export interface AgentProcess {
  /** Send a user message to the agent's stdin. */
  send(input: string): void;
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
export interface SpawnOptions {
  cwd: string;
  prompt?: string;
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  env?: Record<string, string>;
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
