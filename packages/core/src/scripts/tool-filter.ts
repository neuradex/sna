/**
 * tool-filter.ts — PreToolUse hook that enforces allowedTools/disallowedTools.
 *
 * Generated dynamically by CodexProvider when tool restrictions are set.
 * Works with both Claude Code and Codex hooks.
 *
 * Args:
 *   --allowed tool1,tool2,...   Only allow these tools
 *   --disallowed tool1,tool2,...  Block these tools
 *
 * stdin: { tool_name, tool_input, ... }
 * stdout: { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason? } }
 */

const chunks: Buffer<ArrayBufferLike>[] = [];
process.stdin.on("data", (chunk: Buffer<ArrayBufferLike>) => chunks.push(chunk));

process.stdin.on("end", () => {
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    if (!raw) { allow(); return; }

    const input = JSON.parse(raw) as { tool_name?: string };
    const toolName = input.tool_name ?? "";

    // Parse args
    const allowedArg = process.argv.find(a => a.startsWith("--allowed="))?.slice(10);
    const disallowedArg = process.argv.find(a => a.startsWith("--disallowed="))?.slice(13);

    const allowedTools = allowedArg ? allowedArg.split(",").filter(Boolean) : null;
    const disallowedTools = disallowedArg ? disallowedArg.split(",").filter(Boolean) : null;

    // allowedTools takes precedence
    if (allowedTools) {
      if (allowedTools.includes(toolName)) {
        allow();
      } else {
        deny(`Tool "${toolName}" is not in the allowed list`);
      }
      return;
    }

    if (disallowedTools) {
      if (disallowedTools.includes(toolName)) {
        deny(`Tool "${toolName}" is blocked`);
      } else {
        allow();
      }
      return;
    }

    allow();
  } catch {
    allow(); // On error, allow by default
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
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}
