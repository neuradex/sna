import fs from "fs";
import path from "path";
import { getConfig } from "../config.js";
import { splitContentByEmbeds } from "./embed-refs.js";
function renderTextWithEmbeds(content, embeds, sessionId) {
  const segments = splitContentByEmbeds(content);
  const out = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      if (seg.text.length > 0) out.push({ type: "text", text: seg.text });
    } else {
      const record = embeds?.[seg.id];
      if (!record) continue;
      const data = loadEmbedAsBase64(sessionId, record);
      if (!data) continue;
      out.push({
        type: "image",
        source: { type: "base64", media_type: record.mime_type, data }
      });
    }
  }
  return out;
}
function loadEmbedAsBase64(sessionId, record) {
  const fullPath = path.isAbsolute(record.path) ? record.path : path.join(getConfig().dataDir, "images", sessionId, record.path);
  try {
    return fs.readFileSync(fullPath).toString("base64");
  } catch {
    return null;
  }
}
function canonicalToAnthropicMessages(blocks, sessionId) {
  const msgs = [];
  let current = null;
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
        const signature = typeof b.meta?.signature === "string" ? b.meta.signature : void 0;
        current.content.push({ type: "thinking", thinking: b.content, ...signature ? { signature } : {} });
      } else if (b.kind === "tool_use") {
        const id = b.meta?.id ?? `tool_${b.id ?? Math.random().toString(36).slice(2)}`;
        const name = b.content || b.meta?.name || "tool";
        const input = b.meta?.input ?? {};
        current.content.push({ type: "tool_use", id, name, input });
      }
      continue;
    }
    if (b.actor === "system" && b.kind === "tool_result") {
      if (!current || current.role !== "user") {
        flushCurrent();
        current = { role: "user", content: [] };
      }
      const toolUseId = b.meta?.toolUseId ?? "";
      const isError = b.meta?.isError === true;
      const inner = renderTextWithEmbeds(b.content, b.embeds, sessionId);
      const resultContent = inner.length === 1 && inner[0].type === "text" ? inner[0].text : inner;
      current.content.push({
        type: "tool_result",
        tool_use_id: toolUseId,
        content: resultContent,
        ...isError ? { is_error: true } : {}
      });
      continue;
    }
  }
  flushCurrent();
  return repairOrphanToolUses(msgs);
}
function repairOrphanToolUses(msgs) {
  const repaired = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    repaired.push(m);
    if (m.role !== "assistant") continue;
    const toolUseIds = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
    if (toolUseIds.length === 0) continue;
    const next = msgs[i + 1];
    const satisfied = /* @__PURE__ */ new Set();
    if (next && next.role === "user") {
      for (const b of next.content) {
        if (b.type === "tool_result") satisfied.add(b.tool_use_id);
      }
    }
    const missing = toolUseIds.filter((id) => !satisfied.has(id));
    if (missing.length === 0) continue;
    const syntheticResults = missing.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: "(tool call did not produce a result; synthesized during history restore)",
      is_error: true
    }));
    if (next && next.role === "user") {
      next.content = [...syntheticResults, ...next.content];
    } else {
      repaired.push({ role: "user", content: syntheticResults });
    }
  }
  return repaired;
}
function assertAlternating(msgs) {
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].role === msgs[i - 1].role) {
      throw new Error(
        `Claude JSONL validation failed: consecutive ${msgs[i].role} at index ${i - 1} and ${i}. This usually means canonical blocks are mis-ordered (tool_result without a preceding tool_use, etc.).`
      );
    }
  }
}
function writeClaudeHistoryJsonl(blocks, opts) {
  const msgs = canonicalToAnthropicMessages(blocks, opts.sessionId);
  if (msgs.length === 0) return null;
  assertAlternating(msgs);
  try {
    const dir = path.join(opts.cwd, ".sna", "history");
    fs.mkdirSync(dir, { recursive: true });
    const syntheticSessionId = crypto.randomUUID();
    const filePath = path.join(dir, `${syntheticSessionId}.jsonl`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const lines = [];
    let prevUuid = null;
    for (const m of msgs) {
      const uuid = crypto.randomUUID();
      lines.push(JSON.stringify({
        parentUuid: prevUuid,
        isSidechain: false,
        type: m.role,
        // "user" | "assistant"
        uuid,
        timestamp: now,
        cwd: opts.cwd,
        sessionId: syntheticSessionId,
        message: { role: m.role, content: m.content }
      }));
      prevUuid = uuid;
    }
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    return { filePath, extraArgs: ["--resume", filePath] };
  } catch {
    return null;
  }
}
export {
  writeClaudeHistoryJsonl
};
