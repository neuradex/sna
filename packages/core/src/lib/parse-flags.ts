/**
 * parse-flags.ts — Shared CLI flag parser for SNA scripts.
 *
 * Parses --key value pairs from argv-style arrays.
 */

/**
 * Parse --key value pairs from an argument array.
 * Handles --flag (without value) by setting it to "true".
 */
export function parseFlags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}
