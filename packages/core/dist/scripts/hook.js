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
    let apiUrl;
    if (process.env.SNA_API_URL) {
      apiUrl = process.env.SNA_API_URL;
    } else if (process.env.SNA_PORT) {
      apiUrl = `http://localhost:${process.env.SNA_PORT}`;
    } else {
      const portFile = path.join(process.cwd(), ".sna/sna-api.port");
      try {
        const port = fs.readFileSync(portFile, "utf8").trim();
        apiUrl = `http://localhost:${port}`;
      } catch {
        allow();
        return;
      }
    }
    const sessionId = process.argv.find((a) => a.startsWith("--session="))?.slice(10) ?? process.env.SNA_SESSION_ID ?? "default";
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
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}
