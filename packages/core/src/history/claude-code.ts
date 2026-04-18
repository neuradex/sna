/**
 * Claude Code history adapter.
 *
 * Converts canonical blocks into Anthropic's native wire format and writes a
 * JSONL session file that Claude Code's CLI accepts via `--resume <filepath>`.
 * (Key discovery: passing a .jsonl path to --resume bypasses CC's project
 * directory lookup and calls loadMessagesFromJsonlPath directly — this is the
 * only reliable way to inject synthetic history into CC.)
 *
 * Anthropic wire format quirks handled here:
 *   - assistant text + tool_use blocks are packed into a single assistant
 *     message (preserves parallel tool-call batching)
 *   - tool_result blocks are wrapped in a synthetic user message (per Anthropic
 *     convention, even though tool output is semantically from the system)
 *   - images inline refs (`![](embed://<id>)`) are resolved from each block's
 *     embeds map and emitted as `{type:"image",source:{base64}}` blocks
 *     interleaved with text, preserving the order the user/tool produced them
 */

import fs from "fs";
import path from "path";
import { getConfig } from "../config.js";
import type { CanonicalBlock, EmbedRecord } from "./types.js";
import { splitContentByEmbeds } from "./embed-refs.js";

// ── Anthropic wire-format types (partial) ──────────────────────────────────

type AnthropicText = { type: "text"; text: string };
type AnthropicImage = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
type AnthropicToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
type AnthropicToolResult = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<AnthropicText | AnthropicImage>;
  is_error?: boolean;
};
type AnthropicThinking = { type: "thinking"; thinking: string; signature?: string };
type AnthropicBlock = AnthropicText | AnthropicImage | AnthropicToolUse | AnthropicToolResult | AnthropicThinking;

// ── Content rendering ──────────────────────────────────────────────────────

/**
 * Turn a canonical text-with-embed-refs string into an interleaved array of
 * Anthropic content blocks. Empty text segments are dropped.
 */
function renderTextWithEmbeds(
  content: string,
  embeds: Record<string, EmbedRecord> | undefined,
  sessionId: string,
): Array<AnthropicText | AnthropicImage> {
  const segments = splitContentByEmbeds(content);
  const out: Array<AnthropicText | AnthropicImage> = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      if (seg.text.length > 0) out.push({ type: "text", text: seg.text });
    } else {
      const record = embeds?.[seg.id];
      if (!record) continue; // Dangling ref — skip rather than fail
      const data = loadEmbedAsBase64(sessionId, record);
      if (!data) continue;
      out.push({
        type: "image",
        source: { type: "base64", media_type: record.mime_type, data },
      });
    }
  }
  return out;
}

function loadEmbedAsBase64(sessionId: string, record: EmbedRecord): string | null {
  const fullPath = path.isAbsolute(record.path)
    ? record.path
    : path.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    return fs.readFileSync(fullPath).toString("base64");
  } catch {
    return null;
  }
}

// ── Canonical → Anthropic messages ─────────────────────────────────────────

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

/**
 * Walk canonical blocks in order and materialize Anthropic-style messages.
 *
 * Rules:
 *   - actor='user'          → user message with text + image blocks
 *   - actor='assistant'     → accumulate into current assistant message
 *         kind='text'       → text block
 *         kind='thinking'   → thinking block
 *         kind='tool_use'   → tool_use block (closes assistant-text streak but
 *                             doesn't end the message — parallel tool_uses
 *                             can follow before a tool_result arrives)
 *   - actor='system', kind='tool_result'
 *                           → closes current assistant message, opens (or
 *                             extends) a synthetic user message containing
 *                             the tool_result block
 *
 * This preserves the parallel-tool-call signal: multiple tool_uses emitted
 * before the first tool_result end up in the same assistant message.
 */
function canonicalToAnthropicMessages(
  blocks: CanonicalBlock[],
  sessionId: string,
): AnthropicMessage[] {
  const msgs: AnthropicMessage[] = [];
  let current: AnthropicMessage | null = null;

  const flushCurrent = () => {
    if (current && current.content.length > 0) msgs.push(current);
    current = null;
  };

  for (const b of blocks) {
    if (b.actor === "user" && b.kind === "text") {
      flushCurrent();
      current = { role: "user", content: renderTextWithEmbeds(b.content, b.embeds, sessionId) };
      flushCurrent();
      continue;
    }

    if (b.actor === "assistant") {
      if (!current || current.role !== "assistant") {
        flushCurrent();
        current = { role: "assistant", content: [] };
      }
      if (b.kind === "text") {
        current.content.push(...renderTextWithEmbeds(b.content, b.embeds, sessionId));
      } else if (b.kind === "thinking") {
        const signature = typeof b.meta?.signature === "string" ? (b.meta.signature as string) : undefined;
        current.content.push({ type: "thinking", thinking: b.content, ...(signature ? { signature } : {}) });
      } else if (b.kind === "tool_use") {
        const id = (b.meta?.id as string | undefined) ?? `tool_${b.id ?? Math.random().toString(36).slice(2)}`;
        const name = b.content || (b.meta?.name as string | undefined) || "tool";
        const input = (b.meta?.input as unknown) ?? {};
        current.content.push({ type: "tool_use", id, name, input });
      }
      continue;
    }

    if (b.actor === "system" && b.kind === "tool_result") {
      // Consecutive tool_results after the same assistant turn collapse into
      // ONE synthetic user message — that matches Anthropic's wire format for
      // parallel tool calls and preserves the parallel signal.
      if (!current || current.role !== "user") {
        flushCurrent();
        current = { role: "user", content: [] };
      }
      const toolUseId = (b.meta?.toolUseId as string | undefined) ?? "";
      const isError = b.meta?.isError === true;
      const inner = renderTextWithEmbeds(b.content, b.embeds, sessionId);
      const resultContent: AnthropicToolResult["content"] =
        inner.length === 1 && inner[0].type === "text" ? inner[0].text : inner;
      current.content.push({
        type: "tool_result",
        tool_use_id: toolUseId,
        content: resultContent,
        ...(isError ? { is_error: true } : {}),
      });
      continue;
    }

    // Unknown combinations are dropped silently; the renderer should never
    // see status/error blocks (buildCanonicalFromDb filters those out).
  }

  flushCurrent();
  return repairOrphanToolUses(msgs);
}

/**
 * Anthropic requires every assistant tool_use to be followed (in the very
 * next user message) by a tool_result with matching tool_use_id. Canonical
 * history occasionally contains tool_use blocks whose tool_result never
 * arrived (tool crashed, was denied, provider dropped the result, etc.) —
 * loading such a JSONL into Claude Code rejects the whole session and wipes
 * the user's prior context.
 *
 * Walk the produced messages, collect unpaired tool_use ids per assistant
 * turn, and inject synthetic tool_result blocks into the following user
 * message (creating one if necessary). The synthetic results carry
 * is_error:true + a short placeholder so the model can tell they were
 * reconstructed — more honest than silently dropping the tool_use.
 */
function repairOrphanToolUses(msgs: AnthropicMessage[]): AnthropicMessage[] {
  const repaired: AnthropicMessage[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    repaired.push(m);
    if (m.role !== "assistant") continue;

    const toolUseIds = m.content
      .filter((b): b is AnthropicToolUse => b.type === "tool_use")
      .map((b) => b.id);
    if (toolUseIds.length === 0) continue;

    // Collect tool_result ids already present in the next user message.
    const next = msgs[i + 1];
    const satisfied = new Set<string>();
    if (next && next.role === "user") {
      for (const b of next.content) {
        if (b.type === "tool_result") satisfied.add(b.tool_use_id);
      }
    }

    const missing = toolUseIds.filter((id) => !satisfied.has(id));
    if (missing.length === 0) continue;

    const syntheticResults: AnthropicToolResult[] = missing.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: "(tool call did not produce a result; synthesized during history restore)",
      is_error: true,
    }));

    if (next && next.role === "user") {
      // Splice synthetic tool_results to the front so they group with any
      // legitimate tool_results in the same user message.
      next.content = [...syntheticResults, ...next.content];
    } else {
      // No following user message at all — insert one.
      repaired.push({ role: "user", content: syntheticResults });
    }
  }
  return repaired;
}

// ── JSONL session file ────────────────────────────────────────────────────

/**
 * Validate that the produced Anthropic messages alternate user↔assistant.
 * CC's JSONL loader rejects consecutive same-role messages.
 */
function assertAlternating(msgs: AnthropicMessage[]): void {
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].role === msgs[i - 1].role) {
      throw new Error(
        `Claude JSONL validation failed: consecutive ${msgs[i].role} at index ${i - 1} and ${i}. ` +
        `This usually means canonical blocks are mis-ordered (tool_result without a preceding tool_use, etc.).`
      );
    }
  }
}

export interface ClaudeHistoryResult {
  /** Absolute path to the written JSONL session file. */
  filePath: string;
  /** CLI args to append to claude invocation (typically `["--resume", filePath]`). */
  extraArgs: string[];
}

/**
 * Convert canonical blocks into a Claude Code JSONL session file and return
 * the CLI args needed to resume from it. Returns null if the directory cannot
 * be created or file cannot be written (caller falls back to no-history).
 */
export function writeClaudeHistoryJsonl(
  blocks: CanonicalBlock[],
  opts: { cwd: string; sessionId: string },
): ClaudeHistoryResult | null {
  const msgs = canonicalToAnthropicMessages(blocks, opts.sessionId);
  if (msgs.length === 0) return null;
  assertAlternating(msgs);

  try {
    const dir = path.join(opts.cwd, ".sna", "history");
    fs.mkdirSync(dir, { recursive: true });

    const syntheticSessionId = crypto.randomUUID();
    const filePath = path.join(dir, `${syntheticSessionId}.jsonl`);
    const now = new Date().toISOString();

    const lines: string[] = [];
    let prevUuid: string | null = null;
    for (const m of msgs) {
      const uuid = crypto.randomUUID();
      lines.push(JSON.stringify({
        parentUuid: prevUuid,
        isSidechain: false,
        type: m.role, // "user" | "assistant"
        uuid,
        timestamp: now,
        cwd: opts.cwd,
        sessionId: syntheticSessionId,
        message: { role: m.role, content: m.content },
      }));
      prevUuid = uuid;
    }

    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    return { filePath, extraArgs: ["--resume", filePath] };
  } catch {
    return null;
  }
}
