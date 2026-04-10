#!/usr/bin/env tsx
import { startApiProxy } from "../lib/api-proxy.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
const CLAUDE_PATH_FILE = path.join(process.cwd(), ".sna/claude-path");
async function main() {
  let claudePath = "claude";
  try {
    claudePath = fs.readFileSync(CLAUDE_PATH_FILE, "utf8").trim() || claudePath;
  } catch {
  }
  const proxy = await startApiProxy({
    onRequest: (info) => {
      if (!info.system) return;
      const text = typeof info.system === "string" ? info.system : JSON.stringify(info.system, null, 2);
      console.log(`
=== SYSTEM PROMPT (${text.length} chars, model=${info.model}) ===`);
      console.log(text.slice(0, 1e3));
      if (text.length > 1e3) console.log(`
... (${text.length - 1e3} more chars)`);
      console.log("===\n");
    }
  });
  console.log(`Proxy on :${proxy.port}
`);
  const customPrompt = "You are a TEST bot. Respond with ONLY the word 'REPLACED' and nothing else.";
  const proc = spawn(claudePath, [
    "-p",
    "hello",
    "--system-prompt",
    customPrompt,
    "--max-turns",
    "1"
  ], {
    env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  proc.stdout.on("data", (d) => {
    stdout += d.toString();
  });
  proc.stderr.on("data", (d) => {
    process.stderr.write(d);
  });
  proc.on("close", (code) => {
    console.log(`Exit: ${code}`);
    console.log(`Response: ${stdout.trim()}`);
    proxy.close();
  });
}
main().catch(console.error);
