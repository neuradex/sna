import { AgentProvider, SpawnOptions, AgentProcess } from './types.js';

declare function validateCodexPath(codexPath: string): {
    ok: boolean;
    version?: string;
};
declare function cacheCodexPath(codexPath: string, cacheDir?: string): void;
interface CodexResolveResult {
    path: string;
    version?: string;
    source: "env" | "cache" | "static" | "shell" | "fallback";
}
declare function resolveCodexCli(opts?: {
    cacheDir?: string;
}): CodexResolveResult;
declare class CodexProvider implements AgentProvider {
    readonly name = "codex";
    isAvailable(): Promise<boolean>;
    spawn(options: SpawnOptions): AgentProcess;
}

export { CodexProvider, type CodexResolveResult, cacheCodexPath, resolveCodexCli, validateCodexPath };
