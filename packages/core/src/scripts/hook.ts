/**
 * hook.ts — Claude Code PreToolUse hook handler
 *
 * Configured via --settings or .claude/settings.json:
 *   "hooks": { "PreToolUse": [{ "matcher": ".*", "type": "command",
 *     "command": "node \"$CLAUDE_PROJECT_DIR\"/node_modules/@sna-sdk/core/dist/scripts/hook.js" }] }
 *
 * Fires BEFORE every tool execution. Submits a permission request to the
 * SNA API and waits for user approval/denial from the UI.
 *
 * Output (stdout JSON):
 *   { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow"|"deny" } }
 *
 * Exit codes:
 *   0 — decision made (allow/deny via JSON output)
 *   2 — block the tool (stderr fed back to Claude as error)
 */

import fs from "fs";
import path from "path";

const chunks: Buffer<ArrayBufferLike>[] = [];
process.stdin.on("data", (chunk: Buffer<ArrayBufferLike>) => chunks.push(chunk));

process.stdin.on("end", async () => {
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    if (!raw) { allow(); return; }

    const input = JSON.parse(raw) as {
      hook_event_name?: string;
      tool_name?: string;
      tool_input?: Record<string, unknown>;
    };

    const toolName = input.tool_name ?? "unknown";

    // Auto-allow safe tools without asking
    const safeTools = ["Read", "Glob", "Grep", "Agent", "TodoRead", "TodoWrite"];
    if (safeTools.includes(toolName)) { allow(); return; }

    // Resolve SNA API port
    const portFile = path.join(process.cwd(), ".sna/sna-api.port");
    let port: string;
    try {
      port = fs.readFileSync(portFile, "utf8").trim();
    } catch {
      allow(); return; // No SNA API — allow by default
    }

    const sessionId = process.env.SNA_SESSION_ID ?? "default";
    const apiUrl = `http://localhost:${port}`;

    // Submit permission request and wait for UI response
    const res = await fetch(`${apiUrl}/agent/permission-request?session=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool_name: input.tool_name,
        tool_input: input.tool_input,
      }),
      signal: AbortSignal.timeout(300_000), // 5 min timeout
    });

    const data = await res.json() as { approved: boolean };

    if (data.approved) {
      allow();
    } else {
      deny("User denied this tool execution");
    }
  } catch {
    allow(); // On error, allow by default to avoid blocking
  }
});

function allow() {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  }));
  process.exit(0);
}

function deny(reason: string) {
  process.stderr.write(reason);
  process.exit(2);
}
