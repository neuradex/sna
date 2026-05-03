import { AgentProvider, CompleteOptions, CompletionResult, SpawnOptions, AgentProcess } from './types.js';
import '../../history/types.js';
import '../../db/schema.js';
import 'better-sqlite3';

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
    complete(options: CompleteOptions): Promise<CompletionResult>;
    spawn(options: SpawnOptions): AgentProcess;
}

export { CodexProvider, type CodexResolveResult, cacheCodexPath, extractResumeArg, extractSystemPromptArgs, resolveCodexCli, toCodexSandbox, validateCodexPath };
