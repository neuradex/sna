/**
 * Canonical conversation types.
 *
 * This is SNA's provider-neutral, high-resolution representation of a
 * conversation. Each provider (Claude Code, Codex, ...) has its own wire
 * format — adapters translate between canonical and provider-native formats.
 *
 * Design principles:
 * - Flat (one block per row), not nested (not Anthropic-style content arrays).
 *   Flat is more streaming-friendly, query-friendly, and provider-neutral.
 *   Grouping into Anthropic-style messages happens at the adapter layer.
 * - actor (who) and kind (what) are orthogonal. Legacy role conflated them.
 * - Attachments live in `embeds` keyed by id; content text holds inline refs
 *   `![](embed://<id>)`. This mirrors Anthropic's "images live inside the
 *   message" semantics without forcing a JSON content array.
 */
import type { ChatActor, ChatKind } from "../db/schema.js";

export type { ChatActor, ChatKind };

/** Attached binary — image, file, etc. Addressed by id from content inline refs. */
export interface EmbedRecord {
  /** MIME type, e.g. "image/png", "application/pdf". */
  mime_type: string;
  /** Path within SNA's image/file storage (relative to dataDir/images/{sessionId}/). */
  path: string;
  /** Optional metadata — dimensions, source, etc. */
  meta?: Record<string, unknown>;
}

/** A canonical block — one unit emitted by an actor. Corresponds to one chat_messages row. */
export interface CanonicalBlock {
  /** Unique id within session (for referencing). Typically the DB row id. */
  id?: number;
  actor: ChatActor;
  kind: ChatKind;
  /** Text body. May contain inline embed refs: `![](embed://<id>)`. */
  content: string;
  /** Attachments referenced by content. Key = embed id used in `embed://` ref. */
  embeds?: Record<string, EmbedRecord>;
  /** Kind-specific structured overlay.
   *  - tool_use: { id: string; input: unknown; name?: string }
   *  - tool_result: { toolUseId: string; isError?: boolean }
   *  - status: { usage?, model?, provider?, durationMs?, costUsd? }
   *  - thinking: { signature?: string }
   */
  meta?: Record<string, unknown>;
  createdAt?: string;
}

/**
 * Grouped canonical "message" — an adapter-layer convenience view.
 * Adapters can walk CanonicalBlock[] and materialize messages grouped by
 * logical turns. Not stored; derived on demand.
 */
export interface CanonicalMessage {
  role: ChatActor;
  blocks: CanonicalBlock[];
}
