import type { AgentProvider, AgentProcess, SpawnOptions } from "./types.js";

/**
 * Codex provider stub.
 *
 * Codex uses JSONL output: `codex exec --json "prompt"`
 * Event types: thread.started, turn.started, turn.completed,
 *              turn.failed, item.completed, error
 *
 * Not yet implemented — placeholder to validate the provider interface.
 */
export class CodexProvider implements AgentProvider {
  readonly name = "codex";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  spawn(_options: SpawnOptions): AgentProcess {
    throw new Error("Codex provider not yet implemented");
  }
}
