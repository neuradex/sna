import fs from "fs";
import path from "path";
function writeSessionJsonl(history, opts) {
  try {
    const configDir = opts.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(process.env.HOME ?? "", ".claude");
    const projectHash = sanitizePath(opts.cwd);
    const projectDir = path.join(configDir, "projects", projectHash);
    fs.mkdirSync(projectDir, { recursive: true });
    const sessionId = crypto.randomUUID();
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const lines = [];
    let prevUuid = null;
    for (const msg of history) {
      const uuid = crypto.randomUUID();
      if (msg.role === "user") {
        lines.push(JSON.stringify({
          type: "user",
          uuid,
          parentUuid: prevUuid,
          sessionId,
          timestamp: now,
          cwd: opts.cwd,
          message: { role: "user", content: msg.content }
        }));
      } else {
        lines.push(JSON.stringify({
          type: "assistant",
          uuid,
          parentUuid: prevUuid,
          sessionId,
          timestamp: now,
          message: {
            role: "assistant",
            content: [{ type: "text", text: msg.content }]
          }
        }));
      }
      prevUuid = uuid;
    }
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    return { sessionId, extraArgs: ["--resume", sessionId] };
  } catch {
    return null;
  }
}
function buildRecalledConversation(history) {
  const xml = history.map((msg) => `<${msg.role}>${msg.content}</${msg.role}>`).join("\n");
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `<recalled-conversation>
${xml}
</recalled-conversation>` }]
    }
  });
}
function sanitizePath(p) {
  return p.replace(/\//g, "-");
}
export {
  buildRecalledConversation,
  writeSessionJsonl
};
