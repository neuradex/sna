/**
 * Build canonical blocks from the chat_messages DB table.
 *
 * Single read path that consumers (Langfuse tracer, cross-provider history
 * adapters, UI reconstruction) use. Returns full-resolution data (actor, kind,
 * content, embeds, meta) without any provider-specific reshaping — that
 * happens in adapters under `./claude-code` and `./codex`.
 *
 * Ordering is strictly by row id (ascending) which matches emission order.
 * That ordering is the only signal adapters need to reconstruct parallel
 * tool_use batching for Anthropic wire format (multiple tool_uses before the
 * first tool_result → same assistant message).
 */

import { getDb } from "../db/schema.js";
import type { ChatMessage } from "../db/schema.js";
import type { CanonicalBlock, EmbedRecord } from "./types.js";

/** Load all canonical blocks for a session in emission order. */
export function buildCanonicalFromDb(sessionId: string): CanonicalBlock[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, actor, kind, content, embeds, meta, created_at
       FROM chat_messages
      WHERE session_id = ?
      ORDER BY id ASC`,
  ).all(sessionId) as Array<Pick<ChatMessage, "id" | "actor" | "kind" | "content" | "embeds" | "meta" | "created_at">>;

  const out: CanonicalBlock[] = [];
  for (const r of rows) {
    // Skip bookkeeping blocks — they're not conversation content.
    if (r.kind === "status" || r.kind === "error") continue;

    let embeds: Record<string, EmbedRecord> | undefined;
    if (r.embeds) {
      try { embeds = JSON.parse(r.embeds) as Record<string, EmbedRecord>; } catch { /* malformed */ }
    }

    let meta: Record<string, unknown> | undefined;
    if (r.meta) {
      try { meta = JSON.parse(r.meta) as Record<string, unknown>; } catch { /* malformed */ }
    }

    out.push({
      id: r.id,
      actor: r.actor,
      kind: r.kind,
      content: r.content,
      embeds,
      meta,
      createdAt: r.created_at,
    });
  }
  return out;
}
