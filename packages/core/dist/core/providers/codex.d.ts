import { AgentProvider, SpawnOptions, AgentProcess } from './types.js';

/**
 * Codex provider stub.
 *
 * Codex uses JSONL output: `codex exec --json "prompt"`
 * Event types: thread.started, turn.started, turn.completed,
 *              turn.failed, item.completed, error
 *
 * Not yet implemented — placeholder to validate the provider interface.
 */
declare class CodexProvider implements AgentProvider {
    readonly name = "codex";
    isAvailable(): Promise<boolean>;
    spawn(_options: SpawnOptions): AgentProcess;
}

export { CodexProvider };
