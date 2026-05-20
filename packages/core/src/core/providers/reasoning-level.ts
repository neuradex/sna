/**
 * Provider-agnostic 0..5 reasoning-level scale, plus the per-provider
 * translation. Centralised so the mapping is reviewable in one place.
 *
 * 0 is the lightest reasoning the provider supports, 5 is the heaviest.
 * The translation tables collapse where the provider's own scale is
 * shorter than 6 steps:
 *
 *   level | Claude Code `--effort` | Codex `model_reasoning_effort` | Grok `--effort`
 *   ------+------------------------+--------------------------------+----------------
 *     0   | low                    | none                           | low
 *     1   | low      (collapse)    | minimal                        | low (collapse)
 *     2   | medium                 | low                            | medium
 *     3   | high                   | medium                         | high
 *     4   | xhigh                  | high                           | xhigh
 *     5   | max                    | xhigh                          | max
 *
 * OpenCode currently has no equivalent knob exposed in its provider —
 * `reasoningLevel` is silently ignored there.
 *
 * Cursor is different: it has no `--effort` flag at all. Instead the
 * effort is baked into the model id itself — `gpt-5.3-codex` (default)
 * vs `gpt-5.3-codex-low`, `…-high`, `…-xhigh`. See `applyCursorReasoning`
 * below; it transforms a base model id by appending the matching suffix.
 * Models without an effort family (e.g. `composer-2.5`, `auto`) are
 * returned unchanged.
 */

export type ReasoningLevel = 0 | 1 | 2 | 3 | 4 | 5;

const CLAUDE_TABLE = ["low", "low", "medium", "high", "xhigh", "max"] as const;
const CODEX_TABLE = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
const GROK_TABLE = ["low", "low", "medium", "high", "xhigh", "max"] as const;
// Cursor effort suffixes attached to model ids. Index 0 collapses to no
// suffix (default model behavior) since Cursor doesn't expose a "below
// default" effort.
const CURSOR_SUFFIX_TABLE = ["", "-low", "-low", "", "-high", "-xhigh"] as const;

export type ClaudeEffort = (typeof CLAUDE_TABLE)[number];
export type CodexEffort = (typeof CODEX_TABLE)[number];
export type GrokEffort = (typeof GROK_TABLE)[number];
export type CursorEffortSuffix = (typeof CURSOR_SUFFIX_TABLE)[number];

/** Translate a level to Claude Code's `--effort` argument value. */
export function toClaudeEffort(level: ReasoningLevel): ClaudeEffort {
  return CLAUDE_TABLE[level];
}

/** Translate a level to Codex's `model_reasoning_effort` / `turn/start.effort` value. */
export function toCodexEffort(level: ReasoningLevel): CodexEffort {
  return CODEX_TABLE[level];
}

/** Translate a level to Grok's `--effort` argument value. */
export function toGrokEffort(level: ReasoningLevel): GrokEffort {
  return GROK_TABLE[level];
}

/**
 * Translate a level to a Cursor model-id suffix (`""`, `"-low"`,
 * `"-high"`, `"-xhigh"`). Use {@link applyCursorReasoning} to append it
 * to a model id only when the base model belongs to an effort family.
 */
export function toCursorEffortSuffix(level: ReasoningLevel): CursorEffortSuffix {
  return CURSOR_SUFFIX_TABLE[level];
}

/**
 * Set of Cursor model id prefixes (without an effort suffix) that support
 * the `-low` / `-high` / `-xhigh` variant family. Only these get rewritten
 * by {@link applyCursorReasoning}. All other models (`composer-*`,
 * `claude-*`, `auto`, …) are returned verbatim.
 */
const CURSOR_EFFORT_FAMILIES = [
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5-codex",
];

/**
 * Combine a base Cursor model id with a SNA reasoning level by appending
 * the matching effort suffix when the base model belongs to a known
 * effort family. The base id may already include an effort or `-fast`
 * suffix — we strip those first so the same model can be re-tuned by a
 * subsequent reasoning-level patch without accumulating suffixes.
 *
 *   applyCursorReasoning("gpt-5.3-codex", 4)            → "gpt-5.3-codex-high"
 *   applyCursorReasoning("gpt-5.3-codex-low", 4)        → "gpt-5.3-codex-high"
 *   applyCursorReasoning("gpt-5.3-codex-low-fast", 4)   → "gpt-5.3-codex-high"
 *   applyCursorReasoning("composer-2.5", 4)             → "composer-2.5" (no family match)
 *   applyCursorReasoning("gpt-5.3-codex", undefined)    → "gpt-5.3-codex"
 */
export function applyCursorReasoning(modelId: string | undefined, level: ReasoningLevel | undefined): string | undefined {
  if (!modelId) return modelId;
  // Strip a trailing `-fast` (orthogonal to effort) — we'll preserve it
  // separately if the original carried one. Today we drop it, since SNA
  // doesn't expose a fast knob; consumers wanting `*-fast` should pass the
  // explicit model id.
  const base = modelId.replace(/-fast$/, "");
  // Find a family the model belongs to, and strip any existing effort.
  for (const family of CURSOR_EFFORT_FAMILIES) {
    if (base === family || base.startsWith(`${family}-`)) {
      const trimmed = family; // ignore any existing suffix
      if (level === undefined) return trimmed;
      return `${trimmed}${toCursorEffortSuffix(level)}`;
    }
  }
  // No effort family match — return the (de-fast'd) base id; level is ignored.
  return base;
}
