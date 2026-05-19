/**
 * Provider-agnostic 0..5 reasoning-level scale, plus the per-provider
 * translation. Centralised so the mapping is reviewable in one place.
 *
 * 0 is the lightest reasoning the provider supports, 5 is the heaviest.
 * The translation tables collapse where the provider's own scale is
 * shorter than 6 steps:
 *
 *   level | Claude Code `--effort` | Codex `model_reasoning_effort`
 *   ------+------------------------+-------------------------------
 *     0   | low                    | none
 *     1   | low      (collapse)    | minimal
 *     2   | medium                 | low
 *     3   | high                   | medium
 *     4   | xhigh                  | high
 *     5   | max                    | xhigh
 *
 * OpenCode currently has no equivalent knob exposed in its provider —
 * `reasoningLevel` is silently ignored there.
 */

export type ReasoningLevel = 0 | 1 | 2 | 3 | 4 | 5;

const CLAUDE_TABLE = ["low", "low", "medium", "high", "xhigh", "max"] as const;
const CODEX_TABLE = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ClaudeEffort = (typeof CLAUDE_TABLE)[number];
export type CodexEffort = (typeof CODEX_TABLE)[number];

/** Translate a level to Claude Code's `--effort` argument value. */
export function toClaudeEffort(level: ReasoningLevel): ClaudeEffort {
  return CLAUDE_TABLE[level];
}

/** Translate a level to Codex's `model_reasoning_effort` / `turn/start.effort` value. */
export function toCodexEffort(level: ReasoningLevel): CodexEffort {
  return CODEX_TABLE[level];
}
