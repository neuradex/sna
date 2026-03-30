/**
 * parse-flags.ts — Shared CLI flag parser for SNA scripts.
 *
 * Parses --key value pairs from argv-style arrays.
 */
/**
 * Parse --key value pairs from an argument array.
 * Handles --flag (without value) by setting it to "true".
 */
declare function parseFlags(args: string[]): Record<string, string>;

export { parseFlags };
