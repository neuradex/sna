import fs from "fs";
import path from "path";
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  try {
    const raw = Buffer.concat(chunks).toString().trim();
    if (!raw) {
      allow();
      return;
    }
    const input = JSON.parse(raw);
    const toolName = input.tool_name ?? "unknown";
    const safeTools = ["Read", "Glob", "Grep", "Agent", "TodoRead", "TodoWrite"];
    if (safeTools.includes(toolName)) {
      allow();
      return;
    }
    const portFile = path.join(process.cwd(), ".sna/sna-api.port");
    let port;
    try {
      port = fs.readFileSync(portFile, "utf8").trim();
    } catch {
      allow();
      return;
    }
    const sessionId = process.argv.find((a) => a.startsWith("--session="))?.slice(10) ?? process.env.SNA_SESSION_ID ?? "default";
    const apiUrl = `http://localhost:${port}`;
    const res = await fetch(`${apiUrl}/agent/permission-request?session=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool_name: input.tool_name,
        tool_input: input.tool_input
      }),
      signal: AbortSignal.timeout(3e5)
      // 5 min timeout
    });
    const data = await res.json();
    if (data.approved) {
      allow();
    } else {
      deny("User denied this tool execution");
    }
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
  process.stderr.write(reason);
  process.exit(2);
}
