import { AgentProvider, SpawnOptions, AgentProcess } from './types.js';
import '../../history/types.js';
import '../../db/schema.js';
import 'better-sqlite3';

/**
 * Parse `command -v claude` output to extract the executable path.
 * Handles: direct paths, alias with/without quotes, bare command names.
 * @internal Exported for testing only.
 */
declare function parseCommandVOutput(raw: string): string;
/**
 * Validate a Claude CLI path by running `<path> --version`.
 * Adds the binary's directory to PATH so shebang resolution works (nvm/fnm).
 */
declare function validateClaudePath(claudePath: string): {
    ok: boolean;
    version?: string;
};
/**
 * Save a validated Claude path to cache for faster startup next time.
 */
declare function cacheClaudePath(claudePath: string, cacheDir?: string): void;
interface ResolveResult {
    path: string;
    version?: string;
    source: "env" | "cache" | "static" | "shell" | "fallback";
}
/**
 * Resolve Claude CLI path. Tries: env override → cache → static paths → shell detection.
 * All candidates are validated with `--version` before returning.
 * Consumer apps should call this and handle the `fallback` source (= not found).
 */
declare function resolveClaudeCli(opts?: {
    cacheDir?: string;
}): ResolveResult;
declare class ClaudeCodeProvider implements AgentProvider {
    readonly name = "claude-code";
    isAvailable(): Promise<boolean>;
    spawn(options: SpawnOptions): AgentProcess;
}

export { ClaudeCodeProvider, type ResolveResult, cacheClaudePath, parseCommandVOutput, resolveClaudeCli, validateClaudePath };
