import fs from "fs";
import path from "path";
import { getConfig } from "../config.js";
import { splitContentByEmbeds } from "./embed-refs.js";
function loadEmbedAsDataUrl(sessionId, record) {
  const fullPath = path.isAbsolute(record.path) ? record.path : path.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    const buf = fs.readFileSync(fullPath);
    return `data:${record.mime_type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
function renderUserContent(content, embeds, sessionId) {
  const out = [];
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
function renderAssistantContent(content) {
  return content.length > 0 ? [{ type: "output_text", text: content }] : [];
}
function renderToolOutputContent(content, embeds, sessionId) {
  const segments = splitContentByEmbeds(content);
  const parts = [];
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
function canonicalToCodexResponseItems(blocks, sessionId) {
  const out = [];
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
            encrypted_content: b.meta?.signature ?? null
          });
        }
      } else if (b.kind === "tool_use") {
        const callId = b.meta?.id ?? `call_${b.id ?? Math.random().toString(36).slice(2)}`;
        const name = b.content || b.meta?.name || "tool";
        const input = b.meta?.input ?? {};
        out.push({
          type: "function_call",
          name,
          arguments: typeof input === "string" ? input : JSON.stringify(input),
          call_id: callId
        });
      }
      continue;
    }
    if (b.actor === "system" && b.kind === "tool_result") {
      const callId = b.meta?.toolUseId ?? "";
      const output = renderToolOutputContent(b.content, b.embeds, sessionId);
      out.push({ type: "function_call_output", call_id: callId, output });
      continue;
    }
  }
  return out;
}
export {
  canonicalToCodexResponseItems
};
