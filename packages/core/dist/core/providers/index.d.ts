import { AgentProvider } from './types.js';
export { AgentEvent, AgentProcess, SpawnOptions } from './types.js';
export { ClaudeCodeProvider } from './claude-code.js';
export { CodexProvider } from './codex.js';
import '../../history/types.js';
import '../../db/schema.js';
import 'better-sqlite3';

/**
 * Get a registered provider by name.
 * @throws if provider not found
 */
declare function getProvider(name?: string): AgentProvider;
/** Register a custom provider. */
declare function registerProvider(provider: AgentProvider): void;

export { AgentProvider, getProvider, registerProvider };
