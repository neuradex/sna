/**
 * Codex history adapter.
 *
 * Converts canonical blocks into Codex's `ResponseItem[]` sequence, which the
 * app-server accepts via `thread/resume(history=...)` once the experimental
 * feature `thread/resume.history` is enabled.
 *
 * Codex's ResponseItem model is flat (each block is an independent item), so
 * the mapping is nearly 1:1:
 *   canonical.user(text)            → Message(role=user, content=[input_text|input_image])
 *   canonical.assistant(text)       → Message(role=assistant, content=[output_text])
 *   canonical.assistant(thinking)   → Reasoning
 *   canonical.assistant(tool_use)   → FunctionCall
 *   canonical.system(tool_result)   → FunctionCallOutput
 */

import fs from "fs";
import path from "path";
import { getConfig } from "../config.js";
import type { CanonicalBlock, EmbedRecord } from "./types.js";
import { splitContentByEmbeds } from "./embed-refs.js";

// ── Codex wire-format types (partial) ──────────────────────────────────────

type CodexInputText = { type: "input_text"; text: string };
type CodexInputImage = { type: "input_image"; image_url: string };
type CodexOutputText = { type: "output_text"; text: string };

type CodexMessageItem = {
  type: "message";
  role: "user" | "assistant";
  content: Array<CodexInputText | CodexInputImage | CodexOutputText>;
};
type CodexReasoningItem = {
  type: "reasoning";
  id?: string;
  summary: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string | null;
};
type CodexFunctionCallItem = {
  type: "function_call";
  name: string;
  arguments: string; // JSON-encoded
  call_id: string;
};
type CodexFunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type CodexResponseItem =
  | CodexMessageItem
  | CodexReasoningItem
  | CodexFunctionCallItem
  | CodexFunctionCallOutputItem;

// ── Content rendering ──────────────────────────────────────────────────────

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

function renderUserContent(
  content: string,
  embeds: Record<string, EmbedRecord> | undefined,
  sessionId: string,
): Array<CodexInputText | CodexInputImage> {
  const out: Array<CodexInputText | CodexInputImage> = [];
  for (const seg of splitContentByEmbeds(content)) {
    if (seg.type === "text") {
      if (seg.text.length > 0) out.push({ type: "input_text", text: seg.text });
    } else {
      const record = embeds?.[seg.id];
      if (!record) continue;
      const dataUrl = loadEmbedAsDataUrl(sessionId, record);
      if (!dataUrl) continue;
      out.push({ type: "input_image", image_url: dataUrl });
    }
  }
  return out;
}

function renderAssistantContent(content: string): CodexOutputText[] {
  // Assistant text blocks in Codex are plain output_text — embeds (screenshots
  // from tool output) belong to tool_result blocks, not assistant turns. Any
  // embed refs inside an assistant's text are dropped with the ref marker left
  // in the string, which is harmless.
  return content.length > 0 ? [{ type: "output_text", text: content }] : [];
}

function renderToolOutputContent(
  content: string,
  embeds: Record<string, EmbedRecord> | undefined,
  sessionId: string,
): string {
  // Codex's function_call_output.output is a plain string. If the tool
  // produced images, we inline them as data URLs within the text using
  // markdown syntax — the model will see them as references. Codex may or
  // may not be able to "see" these images depending on model capability;
  // this is the best cross-provider compromise without inventing new item
  // types.
  const segments = splitContentByEmbeds(content);
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      parts.push(seg.text);
    } else {
      const record = embeds?.[seg.id];
      if (!record) continue;
      const dataUrl = loadEmbedAsDataUrl(sessionId, record);
      parts.push(dataUrl ? `![](${dataUrl})` : `(missing embed ${seg.id})`);
    }
  }
  return parts.join("");
}

// ── Canonical → ResponseItem[] ─────────────────────────────────────────────

/**
 * Walk canonical blocks and produce a Codex-native ResponseItem sequence.
 * Each canonical block maps to zero or one ResponseItems; order is preserved.
 */
export function canonicalToCodexResponseItems(
  blocks: CanonicalBlock[],
  sessionId: string,
): CodexResponseItem[] {
  const out: CodexResponseItem[] = [];

  for (const b of blocks) {
    if (b.actor === "user" && b.kind === "text") {
      const content = renderUserContent(b.content, b.embeds, sessionId);
      if (content.length > 0) out.push({ type: "message", role: "user", content });
      continue;
    }

    if (b.actor === "assistant") {
      if (b.kind === "text") {
        const content = renderAssistantContent(b.content);
        if (content.length > 0) out.push({ type: "message", role: "assistant", content });
      } else if (b.kind === "thinking") {
        if (b.content.length > 0) {
          out.push({
            type: "reasoning",
            summary: [{ type: "summary_text", text: b.content }],
            encrypted_content: (b.meta?.signature as string | undefined) ?? null,
          });
        }
      } else if (b.kind === "tool_use") {
        const callId = (b.meta?.id as string | undefined) ?? `call_${b.id ?? Math.random().toString(36).slice(2)}`;
        const name = b.content || (b.meta?.name as string | undefined) || "tool";
        const input = (b.meta?.input as unknown) ?? {};
        out.push({
          type: "function_call",
          name,
          arguments: typeof input === "string" ? input : JSON.stringify(input),
          call_id: callId,
        });
      }
      continue;
    }

    if (b.actor === "system" && b.kind === "tool_result") {
      const callId = (b.meta?.toolUseId as string | undefined) ?? "";
      const output = renderToolOutputContent(b.content, b.embeds, sessionId);
      out.push({ type: "function_call_output", call_id: callId, output });
      continue;
    }
  }

  return out;
}
