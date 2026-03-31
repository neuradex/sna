/**
 * @sna-sdk/core — Skills-Native Application runtime.
 *
 * Server, providers, session management, database, and CLI.
 * No React dependency.
 */

export const DEFAULT_SNA_PORT = 3099;
export const DEFAULT_SNA_URL = `http://localhost:${DEFAULT_SNA_PORT}`;

export type { SkillEvent, ChatSession, ChatMessage } from "./db/schema.js";
export type { AgentEvent, AgentProcess, AgentProvider, SpawnOptions, HistoryMessage, ContentBlock } from "./core/providers/types.js";
export type { Session, SessionInfo, SessionManagerOptions, SessionState } from "./server/session-manager.js";
export { open as dispatchOpen, send as dispatchSend, close as dispatchClose, createHandle as createDispatchHandle } from "./lib/dispatch.js";
export type { DispatchOpenOptions, DispatchOpenResult, DispatchSendOptions, DispatchCloseOptions, DispatchEventType } from "./lib/dispatch.js";
