import fs from "fs";
import path from "path";
function writeHistoryJsonl(history, opts) {
  try {
    const dir = path.join(opts.cwd, ".sna", "history");
    fs.mkdirSync(dir, { recursive: true });
    const sessionId = crypto.randomUUID();
    const filePath = path.join(dir, `${sessionId}.jsonl`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const lines = [];
    let prevUuid = null;
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
          message: { role: "user", content: msg.content }
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
            content: [{ type: "text", text: msg.content }]
          }
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
export {
  buildRecalledConversation,
  writeHistoryJsonl
};
