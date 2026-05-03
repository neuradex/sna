/**
 * @sna-sdk/core — HTTP/WS server runtime for SNA.
 *
 * Wraps Claude Code and Codex as backend processes. Supports oMLX local LLM
 * via ANTHROPIC_BASE_URL routing. Server, providers, session manager,
 * canonical history, and database. No React dependency.
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
