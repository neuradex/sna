const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    if (!raw) {
      allow();
      return;
    }
    const input = JSON.parse(raw);
    const toolName = input.tool_name ?? "";
    const allowedArg = process.argv.find((a) => a.startsWith("--allowed="))?.slice(10);
    const disallowedArg = process.argv.find((a) => a.startsWith("--disallowed="))?.slice(13);
    const allowedTools = allowedArg ? allowedArg.split(",").filter(Boolean) : null;
    const disallowedTools = disallowedArg ? disallowedArg.split(",").filter(Boolean) : null;
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
    allow();
  }
});
function allow() {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow"
    }
  }));
  process.exit(0);
}
function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}
