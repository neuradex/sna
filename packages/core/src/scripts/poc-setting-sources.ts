#!/usr/bin/env tsx
/**
 * PoC: Test --setting-sources with empty value to skip CLAUDE.md
 */

import { startApiProxy } from "../lib/api-proxy.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const CLAUDE_PATH_FILE = path.join(process.cwd(), ".sna/claude-path");

async function main() {
  let claudePath = "claude";
  try { claudePath = fs.readFileSync(CLAUDE_PATH_FILE, "utf8").trim() || claudePath; } catch {}

  const proxy = await startApiProxy({
    onRequest: (info) => {
      if (!info.system) return;
      const text = typeof info.system === "string" ? info.system : JSON.stringify(info.system, null, 2);
      console.log(`\n=== SYSTEM PROMPT (${text.length} chars, model=${info.model}) ===`);
      console.log(text.slice(0, 1500));
      if (text.length > 1500) console.log(`\n... (${text.length - 1500} more chars)`);
      console.log("===\n");

      // Check for CLAUDE.md content
      if (text.includes("claudeMd") || text.includes("CLAUDE.md")) {
        console.log("⚠️  CLAUDE.md content FOUND in system prompt");
      } else {
        console.log("✅ No CLAUDE.md content in system prompt");
      }

      // Check for skills/MCP
      if (text.includes("skills are available")) {
        console.log("⚠️  Skills list FOUND");
      } else {
        console.log("✅ No skills list");
      }

      // Check for memory
      if (text.includes("auto memory") || text.includes("MEMORY.md")) {
        console.log("⚠️  Auto memory FOUND");
      } else {
        console.log("✅ No auto memory");
      }
    },
  });

  console.log(`Proxy on :${proxy.port}`);

  const customPrompt = "You are a TEST bot. Say 'OK' and nothing else.";

  // Test: --system-prompt + --setting-sources (empty)
  console.log("\n--- Test: --system-prompt + --setting-sources (empty) ---\n");

  const proc = spawn(claudePath, [
    "-p", "hello",
    "--system-prompt", customPrompt,
    "--setting-sources", "",
    "--max-turns", "1",
  ], {
    env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => { stdout += d.toString(); });
  proc.stderr.on("data", (d) => { stderr += d.toString(); });

  proc.on("close", (code) => {
    console.log(`Exit: ${code}`);
    console.log(`Response: ${stdout.trim().slice(0, 200)}`);
    if (stderr.trim()) console.log(`Stderr: ${stderr.trim().slice(0, 300)}`);
    proxy.close();
  });
}

main().catch(console.error);
