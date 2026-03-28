/**
 * @sna-sdk/core — Skills-Native Application runtime.
 *
 * Server, providers, session management, database, and CLI.
 * No React dependency.
 */

export const DEFAULT_SNA_PORT = 3099;
export const DEFAULT_SNA_URL = `http://localhost:${DEFAULT_SNA_PORT}`;

export type { SkillEvent } from "./db/schema.js";
export type { AgentEvent, AgentProcess, AgentProvider, SpawnOptions } from "./core/providers/types.js";
export type { Session, SessionInfo, SessionManagerOptions } from "./server/session-manager.js";
