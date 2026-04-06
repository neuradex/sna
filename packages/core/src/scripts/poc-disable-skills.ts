#!/usr/bin/env tsx
import { startApiProxy } from "../lib/api-proxy.js";
import { spawn } from "child_process";
import fs from "fs";

async function main() {
  let cp = "claude";
  try { cp = fs.readFileSync(".sna/claude-path", "utf8").trim() || cp; } catch {}

  const proxy = await startApiProxy({
    onRequest: (info) => {
      if (!info.messages) return;
      for (const m of info.messages as any[]) {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        console.log(`\n[${m.role}] ${content.length} chars`);
        if (content.includes("system-reminder")) {
          console.log("  ⚠️  system-reminder:");
          if (content.includes("skills are available")) console.log("    - Skills");
          if (content.includes("MEMORY.md")) console.log("    - Memory");
          if (content.includes("claudeMd")) console.log("    - CLAUDE.md");
          if (content.includes("currentDate")) console.log("    - currentDate");
          if (content.includes("MCP Server")) console.log("    - MCP");
        } else {
          console.log("  ✅ Clean");
        }
      }
    },
  });

  console.log(`Proxy on :${proxy.port}\n`);
  console.log("--- --system-prompt + --disable-slash-commands only ---\n");

  const proc = spawn(cp, [
    "-p", "hello",
    "--system-prompt", "Say OK.",
    "--disable-slash-commands",
    "--max-turns", "1",
  ], {
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.on("close", (code) => {
    console.log(`\nExit: ${code}, Response: ${out.trim().slice(0, 100)}`);
    proxy.close();
  });
}

main().catch(console.error);
