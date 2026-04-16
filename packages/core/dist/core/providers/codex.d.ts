import { AgentProvider, SpawnOptions, AgentProcess, HistoryMessage } from './types.js';

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
/** @internal Exported for testing only. Maps SNA permissionMode → thread/start sandbox value (kebab-case). */
declare function toCodexSandbox(mode?: string): string;
/**
 * Pack conversation history into a context prefix for the first user message.
 * Codex doesn't support synthetic history injection like Claude Code's JSONL resume,
 * so we prepend it as structured context that the model can reference.
 */
/** @internal Exported for testing only. */
declare function buildHistoryContext(history: HistoryMessage[]): string;
/**
 * Extract --resume <threadId> from extraArgs.
 * Returns the threadId and cleaned args, or null if not found.
 */
/** @internal Exported for testing only. */
declare function extractResumeArg(extraArgs?: string[]): {
    threadId: string;
    cleanArgs: string[];
} | null;
/**
 * Extract system prompt flags from extraArgs.
 * Maps Claude Code flags to Codex thread/start params:
 *   --system-prompt <text>         → baseInstructions
 *   --append-system-prompt <text>  → developerInstructions
 */
/** @internal Exported for testing only. */
declare function extractSystemPromptArgs(extraArgs?: string[]): {
    baseInstructions?: string;
    developerInstructions?: string;
    cleanArgs: string[];
};
declare class CodexProvider implements AgentProvider {
    readonly name = "codex";
    isAvailable(): Promise<boolean>;
    spawn(options: SpawnOptions): AgentProcess;
}

export { CodexProvider, type CodexResolveResult, buildHistoryContext, cacheCodexPath, extractResumeArg, extractSystemPromptArgs, resolveCodexCli, toCodexSandbox, validateCodexPath };
