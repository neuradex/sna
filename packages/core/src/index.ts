/**
 * @sna-sdk/core — HTTP/WS server runtime for SNA.
 *
 * Wraps CLI-backed agent runtimes such as Claude Code and Codex as backend
 * processes. Server, providers, session manager, canonical history, and
 * database. No React dependency.
 */

export { getConfig, setConfig, resetConfig } from "./config.js";
export type { SnaConfig } from "./config.js";

export const DEFAULT_SNA_PORT = 3099;
export const DEFAULT_SNA_URL = `http://localhost:${DEFAULT_SNA_PORT}`;

export type { ChatSession, ChatMessage, ChatActor, ChatKind } from "./db/schema.js";
export type { AgentEvent, AgentProcess, AgentProvider, SpawnOptions, ContentBlock, CompleteOptions } from "./core/providers/types.js";
export type { CanonicalBlock, CanonicalMessage, EmbedRecord } from "./history/types.js";
export { buildCanonicalFromDb } from "./history/canonical.js";
export { completion } from "./core/completion.js";
export type { CompletionOptions, CompletionResult } from "./core/completion.js";
export type { Session, SessionInfo, SessionManagerOptions, SessionState } from "./server/session-manager.js";

// Cross-provider reasoning-effort scale (0..5) and per-provider translators.
// Consumers building their own latency-tuning layers can introspect or
// reuse the same translation tables that codex.ts / claude-code.ts use.
export type { ReasoningLevel } from "./core/providers/reasoning-level.js";
export {
  toClaudeEffort,
  toCodexEffort,
  toGrokEffort,
  toCursorEffortSuffix,
  applyCursorReasoning,
} from "./core/providers/reasoning-level.js";

// Runtime pool — exposed so consumer apps can pre-warm daemons (warmup
// `prepare()` once at startup so subsequent completion()/spawn() calls hit
// the pooled fast path) or inspect existing handles.
export { RuntimePool, getRuntimePool } from "./core/providers/runtime.js";
export type { RuntimeHandle, RuntimeConfig } from "./core/providers/runtime.js";

// One-shot agent execution helper (also reachable through HTTP /agent/run-once
// and WS agent.run-once). Useful for short ephemeral runs without juggling
// SessionManager wiring yourself.
export { runOnce } from "./server/run-once.js";
export type { RunOnceOptions, RunOnceResult } from "./server/run-once.js";
