export { SnaConfig, getConfig, resetConfig, setConfig } from './config.js';
export { ChatActor, ChatKind, ChatMessage, ChatSession } from './db/schema.js';
export { AgentEvent, AgentProcess, AgentProvider, ContentBlock, SpawnOptions } from './core/providers/types.js';
export { CanonicalBlock, CanonicalMessage, EmbedRecord } from './history/types.js';
export { buildCanonicalFromDb } from './history/canonical.js';
export { CompletionOptions, CompletionResult, completion } from './core/completion.js';
export { Session, SessionInfo, SessionManagerOptions, SessionState } from './server/session-manager.js';
import 'better-sqlite3';

/**
 * @sna-sdk/core — HTTP/WS server runtime for SNA.
 *
 * Wraps Claude Code and Codex as backend processes. Supports oMLX local LLM
 * via ANTHROPIC_BASE_URL routing. Server, providers, session manager,
 * canonical history, and database. No React dependency.
 */

declare const DEFAULT_SNA_PORT = 3099;
declare const DEFAULT_SNA_URL = "http://localhost:3099";

export { DEFAULT_SNA_PORT, DEFAULT_SNA_URL };
