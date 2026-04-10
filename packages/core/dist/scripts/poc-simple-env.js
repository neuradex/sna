#!/usr/bin/env tsx
import { startApiProxy } from "../lib/api-proxy.js";
import { spawn } from "child_process";
import fs from "fs";
async function main() {
  let cp = "claude";
  try {
    cp = fs.readFileSync(".sna/claude-path", "utf8").trim() || cp;
  } catch {
  }
  const proxy = await startApiProxy({
    onRequest: (info) => {
      if (!info.messages) return;
      for (const m of info.messages) {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        console.log(`
[${m.role}] ${content.length} chars`);
        if (content.includes("system-reminder")) {
          console.log("  \u26A0\uFE0F  system-reminder:");
          if (content.includes("skills are available")) console.log("    - Skills");
          if (content.includes("MEMORY.md")) console.log("    - Memory");
          if (content.includes("claudeMd")) console.log("    - CLAUDE.md");
          if (content.includes("currentDate")) console.log("    - currentDate");
          if (content.includes("MCP Server")) console.log("    - MCP");
        } else {
          console.log("  \u2705 Clean");
        }
      }
    }
  });
  console.log(`Proxy on :${proxy.port}
`);
  const proc = spawn(cp, [
    "-p",
    "hello",
    "--system-prompt",
    "Say OK.",
    "--max-turns",
    "1"
  ], {
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
      CLAUDE_CODE_SIMPLE: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "", err = "";
  proc.stdout.on("data", (d) => {
    out += d;
  });
  proc.stderr.on("data", (d) => {
    err += d;
  });
  proc.on("close", (code) => {
    console.log(`
Exit: ${code}, Response: ${out.trim().slice(0, 100)}`);
    if (err.trim()) console.log(`Stderr: ${err.trim().slice(0, 200)}`);
    proxy.close();
  });
}
main().catch(console.error);
