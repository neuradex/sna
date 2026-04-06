#!/usr/bin/env tsx
import { startApiProxy } from "../lib/api-proxy.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
const STATE_DIR = path.join(process.cwd(), ".sna");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");
async function main() {
  const userMessage = process.argv[2] ?? "hello";
  let claudePath = "claude";
  try {
    claudePath = fs.readFileSync(CLAUDE_PATH_FILE, "utf8").trim() || claudePath;
  } catch {
  }
  console.log("=== PoC: System Prompt Capture via API Proxy ===\n");
  const proxy = await startApiProxy({
    onRequest: (info) => {
      console.log(`[proxy] \u2192 ${info.model} stream=${info.stream} messages=${info.messageCount}`);
      if (!info.system) return;
      const text = typeof info.system === "string" ? info.system : JSON.stringify(info.system, null, 2);
      console.log(`
${"=".repeat(60)}`);
      console.log(`CAPTURED SYSTEM PROMPT (model=${info.model}, messages=${info.messageCount})`);
      console.log(`Length: ${text.length} chars`);
      console.log(`${"=".repeat(60)}`);
      console.log(text.slice(0, 2e3));
      if (text.length > 2e3) console.log(`
... (${text.length - 2e3} more chars)`);
      console.log(`${"=".repeat(60)}
`);
      const outPath = path.join(STATE_DIR, "captured-system-prompt.txt");
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(outPath, text);
        console.log(`Saved to ${outPath}`);
      } catch (err) {
        console.error(`Failed to save: ${err}`);
      }
    }
  });
  console.log(`Proxy running on 127.0.0.1:${proxy.port}`);
  console.log(`Spawning: ${claudePath} -p "${userMessage}" --max-turns 1
`);
  const proc = spawn(claudePath, ["-p", userMessage, "--max-turns", "1"], {
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`
    },
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
    console.log(`
Claude exited with code ${code}`);
    const lines = stdout.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === "assistant" && ev.message?.content) {
          const text = ev.message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
          console.log(`
Assistant: ${text.slice(0, 200)}`);
        }
      } catch {
      }
    }
    proxy.close();
    process.exit(code ?? 0);
  });
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
