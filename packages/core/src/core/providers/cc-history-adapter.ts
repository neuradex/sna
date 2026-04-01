/**
 * History injection for Claude Code via JSONL resume.
 *
 * Writes a JSONL session file and passes --resume <filepath> to CC.
 * CC loads it as real multi-turn conversation history.
 *
 * Key discovery: --resume with a .jsonl file path bypasses CC's project
 * directory lookup and calls loadMessagesFromJsonlPath directly.
 * This is the only reliable way to inject synthetic history.
 *
 * Verified: real Claude Haiku correctly recalls injected context.
 * Fallback: recalled-conversation XML if file write fails.
 */

import fs from "fs";
import path from "path";
import type { HistoryMessage } from "./types.js";

// ── JSONL Resume (Primary) ──────────────────────────────────────

/**
 * Write a JSONL session file for --resume <filepath>.
 *
 * Minimal format (verified working):
 *   {"parentUuid":null,"isSidechain":false,"type":"user","uuid":"...","timestamp":"...","cwd":"...","sessionId":"...","message":{"role":"user","content":"..."}}
 *   {"parentUuid":"<prev>","isSidechain":false,"type":"assistant","uuid":"...","timestamp":"...","cwd":"...","sessionId":"...","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
 */
export function writeHistoryJsonl(
  history: HistoryMessage[],
  opts: { cwd: string },
): { filePath: string; extraArgs: string[] } | null {
  // Validate: must alternate user↔assistant, no consecutive same role
  for (let i = 1; i < history.length; i++) {
    if (history[i].role === history[i - 1].role) {
      throw new Error(
        `History validation failed: consecutive ${history[i].role} at index ${i - 1} and ${i}. ` +
        `Messages must alternate user↔assistant. Merge tool results into text before injecting.`
      );
    }
  }

  try {
    const dir = path.join(opts.cwd, ".sna", "history");
    fs.mkdirSync(dir, { recursive: true });

    const sessionId = crypto.randomUUID();
    const filePath = path.join(dir, `${sessionId}.jsonl`);
    const now = new Date().toISOString();

    const lines: string[] = [];
    let prevUuid: string | null = null;

    for (const msg of history) {
      const uuid = crypto.randomUUID();

      if (msg.role === "user") {
        lines.push(JSON.stringify({
          parentUuid: prevUuid,
          isSidechain: false,
          type: "user",
          uuid,
          timestamp: now,
          cwd: opts.cwd,
          sessionId,
          message: { role: "user", content: msg.content },
        }));
      } else {
        lines.push(JSON.stringify({
          parentUuid: prevUuid,
          isSidechain: false,
          type: "assistant",
          uuid,
          timestamp: now,
          cwd: opts.cwd,
          sessionId,
          message: {
            role: "assistant",
            content: [{ type: "text", text: msg.content }],
          },
        }));
      }

      prevUuid = uuid;
    }

    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    return { filePath, extraArgs: ["--resume", filePath] };
  } catch {
    return null;
  }
}

// ── Recalled-Conversation (Fallback) ────────────────────────────

/**
 * Pack history into a single assistant stdin message.
 * CC treats type:"assistant" as context injection (no API call triggered).
 * Used when file write fails.
 */
export function buildRecalledConversation(history: HistoryMessage[]): string {
  const xml = history
    .map((msg) => `<${msg.role}>${msg.content}</${msg.role}>`)
    .join("\n");
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `<recalled-conversation>\n${xml}\n</recalled-conversation>` }],
    },
  });
}
