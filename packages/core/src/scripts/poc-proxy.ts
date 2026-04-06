#!/usr/bin/env tsx
/**
 * PoC: Capture Claude Code's system prompt via transparent API proxy.
 *
 * Usage:
 *   npx tsx src/scripts/poc-proxy.ts "hello"
 *
 * What it does:
 * 1. Starts a transparent proxy on a random port
 * 2. Spawns Claude Code with ANTHROPIC_BASE_URL pointing to the proxy
 * 3. Proxy forwards everything to real Anthropic API
 * 4. Captures and prints the system prompt from the first request
 * 5. Saves system prompt to .sna/captured-system-prompt.txt
 */

import { startApiProxy } from "../lib/api-proxy.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const STATE_DIR = path.join(process.cwd(), ".sna");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");

async function main() {
  const userMessage = process.argv[2] ?? "hello";

  // Resolve claude path
  let claudePath = "claude";
  try {
    claudePath = fs.readFileSync(CLAUDE_PATH_FILE, "utf8").trim() || claudePath;
  } catch {}

  console.log("=== PoC: System Prompt Capture via API Proxy ===\n");

  // Start proxy
  const proxy = await startApiProxy({
    onRequest: (info) => {
      console.log(`[proxy] → ${info.model} stream=${info.stream} messages=${info.messageCount}`);
      if (!info.system) return;

      const text = typeof info.system === "string" ? info.system : JSON.stringify(info.system, null, 2);
      console.log(`\n${"=".repeat(60)}`);
      console.log(`CAPTURED SYSTEM PROMPT (model=${info.model}, messages=${info.messageCount})`);
      console.log(`Length: ${text.length} chars`);
      console.log(`${"=".repeat(60)}`);
      console.log(text.slice(0, 2000));
      if (text.length > 2000) console.log(`\n... (${text.length - 2000} more chars)`);
      console.log(`${"=".repeat(60)}\n`);

      const outPath = path.join(STATE_DIR, "captured-system-prompt.txt");
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(outPath, text);
        console.log(`Saved to ${outPath}`);
      } catch (err) {
        console.error(`Failed to save: ${err}`);
      }
    },
  });

  console.log(`Proxy running on 127.0.0.1:${proxy.port}`);
  console.log(`Spawning: ${claudePath} -p "${userMessage}" --max-turns 1\n`);

  // Spawn claude with proxy env
  const proc = spawn(claudePath, ["-p", userMessage, "--max-turns", "1"], {
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  proc.stdout.on("data", (d) => { stdout += d.toString(); });
  proc.stderr.on("data", (d) => { process.stderr.write(d); });

  proc.on("close", (code) => {
    console.log(`\nClaude exited with code ${code}`);

    // Parse stream-json for assistant response
    const lines = stdout.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === "assistant" && ev.message?.content) {
          const text = ev.message.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          console.log(`\nAssistant: ${text.slice(0, 200)}`);
        }
      } catch {}
    }

    proxy.close();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
