/**
 * History injection adapters for Claude Code.
 *
 * Primary: JSONL resume — writes a session file and uses --resume.
 *   Pro: Real multi-turn structure, tool_use preserved.
 *   Con: Depends on CC's JSONL format, CLAUDE_CONFIG_DIR path.
 *
 * Fallback: recalled-conversation — packs history into a single assistant message.
 *   Pro: No file system dependency, format-agnostic.
 *   Con: Loses turn structure (text only).
 */

import fs from "fs";
import path from "path";
import type { HistoryMessage } from "./types.js";

// ── JSONL Resume Adapter ────────────────────────────────────────

/**
 * Write a synthetic JSONL session file that CC can --resume.
 * Returns the session ID to pass as --resume <id>.
 *
 * File location: {configDir}/projects/{projectHash}/{sessionId}.jsonl
 */
export function writeSessionJsonl(
  history: HistoryMessage[],
  opts: { cwd: string; configDir?: string },
): { sessionId: string; extraArgs: string[] } | null {
  try {
    const configDir = opts.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(process.env.HOME ?? "", ".claude");
    const projectHash = sanitizePath(opts.cwd);
    const projectDir = path.join(configDir, "projects", projectHash);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = crypto.randomUUID();
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);
    const now = new Date().toISOString();

    const lines: string[] = [];
    let prevUuid: string | null = null;

    for (const msg of history) {
      const uuid = crypto.randomUUID();

      const common = {
        parentUuid: prevUuid,
        isSidechain: false,
        userType: "external",
        cwd: opts.cwd,
        sessionId,
        version: "0.0.0",
        type: "",
        uuid,
        timestamp: now,
      };

      if (msg.role === "user") {
        lines.push(JSON.stringify({
          ...common,
          type: "user",
          message: { role: "user", content: msg.content },
        }));
      } else {
        lines.push(JSON.stringify({
          ...common,
          type: "assistant",
          message: {
            id: `msg_synth_${uuid.slice(0, 12)}`,
            type: "message",
            role: "assistant",
            model: "synthetic",
            content: [{ type: "text", text: msg.content }],
            stop_reason: "end_turn",
            stop_sequence: "",
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }));
      }

      prevUuid = uuid;
    }

    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    return { sessionId, extraArgs: ["--resume", sessionId] };
  } catch {
    return null; // Fallback to recalled-conversation
  }
}

// ── Recalled-Conversation Fallback ──────────────────────────────

/**
 * Pack history into a single assistant stdin message using XML tags.
 * CC treats type:"assistant" as mutableMessages.push + continue (no API call).
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

// ── Path sanitization (matches CC's format) ─────────────────────

function sanitizePath(p: string): string {
  // CC uses this format: /Users/foo/bar → -Users-foo-bar
  return p.replace(/\//g, "-");
}
