/**
 * OpenCode history adapter.
 *
 * OpenCode's session prompt API (`POST /session/{id}/message`, `prompt_async`)
 * only accepts user-side input parts: TextPartInput, FilePartInput,
 * AgentPartInput, SubtaskPartInput. There is no native equivalent of Codex's
 * experimental `thread/resume(history=ResponseItems)` that can replay an
 * assistant turn, reasoning, or a tool call/result pair into a freshly
 * created OpenCode session.
 *
 * To preserve cross-provider continuity (canonical history → OpenCode), we
 * serialize the prior conversation into a single TextPartInput "prelude"
 * that is prepended to the first user prompt sent on a new OpenCode
 * session. Embeds attached to prior user messages are emitted as
 * FilePartInputs alongside the prelude so images survive the switch.
 *
 * Limitations:
 *   - Tool calls/results are flattened into text — the model sees them as
 *     transcript, not as live tool state.
 *   - This is lossy compared to Codex's history field, but lossless
 *     replays would require OpenCode to gain a server-side history seed.
 *
 * This is exactly one shape (parts to prepend to the first user message),
 * not a separate "thread/resume" RPC. The provider stores the prelude,
 * sends it once on the first real user input, and then clears it.
 */

import type { CanonicalBlock, EmbedRecord } from "./types.js";
import { splitContentByEmbeds } from "./embed-refs.js";
import { getConfig } from "../config.js";
import fs from "fs";
import path from "path";

// ── OpenCode part shapes (subset, matched to @opencode-ai/sdk) ─────────────
//
// We don't import the SDK's TextPartInput/FilePartInput here to keep
// history/* free of provider deps; the provider re-types these into the SDK
// shape at call time. The structural fields below are byte-compatible.

export interface OpenCodeTextPartInput {
  type: "text";
  text: string;
}

export interface OpenCodeFilePartInput {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export type OpenCodePart = OpenCodeTextPartInput | OpenCodeFilePartInput;

// ── Embed loading ──────────────────────────────────────────────────────────

function loadEmbedAsDataUrl(sessionId: string, record: EmbedRecord): string | null {
  const fullPath = path.isAbsolute(record.path)
    ? record.path
    : path.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    const buf = fs.readFileSync(fullPath);
    return `data:${record.mime_type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── Block → transcript line ────────────────────────────────────────────────

function renderBlock(
  b: CanonicalBlock,
  sessionId: string,
  fileParts: OpenCodeFilePartInput[],
): string | null {
  if (b.actor === "user" && b.kind === "text") {
    const segs = splitContentByEmbeds(b.content);
    const textParts: string[] = [];
    for (const seg of segs) {
      if (seg.type === "text") {
        if (seg.text) textParts.push(seg.text);
      } else {
        const record = b.embeds?.[seg.id];
        if (!record) continue;
        const dataUrl = loadEmbedAsDataUrl(sessionId, record);
        if (!dataUrl) continue;
        fileParts.push({ type: "file", mime: record.mime_type, url: dataUrl });
        textParts.push(`(attached: ${record.mime_type})`);
      }
    }
    const body = textParts.join("");
    return body.length > 0 ? `**User:** ${body}` : null;
  }

  if (b.actor === "assistant") {
    if (b.kind === "text") {
      return b.content.length > 0 ? `**Assistant:** ${b.content}` : null;
    }
    if (b.kind === "thinking") {
      return b.content.length > 0 ? `**Assistant (thinking):** ${b.content}` : null;
    }
    if (b.kind === "tool_use") {
      const name = (b.meta?.name as string | undefined) ?? b.content ?? "tool";
      const input = b.meta?.input ?? {};
      const args = typeof input === "string" ? input : JSON.stringify(input);
      return `**Tool call (${name}):** ${args}`;
    }
  }

  if (b.actor === "system" && b.kind === "tool_result") {
    const isErr = b.meta?.isError === true;
    const tag = isErr ? "Tool result (error)" : "Tool result";
    return b.content.length > 0 ? `**${tag}:** ${b.content}` : null;
  }

  return null;
}

// ── Public entry: canonical → OpenCode prelude parts ──────────────────────

/**
 * Build the OpenCode parts that represent prior canonical history as a
 * prepended prelude. Returns an empty array when there is no history.
 *
 * Output shape:
 *   [
 *     { type: "text", text: "<conversation-history>...\n</conversation-history>" },
 *     { type: "file", mime, url } * N   // when prior user messages had embeds
 *   ]
 *
 * Callers should send this array followed by the current user's text
 * (and any new embeds) as `parts` on the first prompt in a fresh session,
 * then drop the prelude on subsequent prompts.
 */
export function canonicalToOpenCodeHistoryPrelude(
  blocks: CanonicalBlock[],
  sessionId: string,
): OpenCodePart[] {
  if (blocks.length === 0) return [];

  const fileParts: OpenCodeFilePartInput[] = [];
  const lines: string[] = ["<conversation-history>"];

  for (const b of blocks) {
    const line = renderBlock(b, sessionId, fileParts);
    if (line) lines.push(line);
  }

  lines.push("</conversation-history>");

  const text = lines.join("\n\n");
  return [{ type: "text", text }, ...fileParts];
}
