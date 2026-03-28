import { AgentProvider, SpawnOptions, AgentProcess } from './types.js';

declare class ClaudeCodeProvider implements AgentProvider {
    readonly name = "claude-code";
    isAvailable(): Promise<boolean>;
    spawn(options: SpawnOptions): AgentProcess;
}

export { ClaudeCodeProvider };
