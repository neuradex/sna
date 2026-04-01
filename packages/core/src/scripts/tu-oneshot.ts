/**
 * sna tu claude:oneshot — auto mock API + run claude + dump all logs.
 *
 * Outputs:
 *   - Claude stdout/stderr
 *   - Mock API request body → .sna/mock-api-last-request.json
 *   - Mock API log → .sna/mock-api.log
 *   - Summary with file paths
 */

import { startMockAnthropicServer } from "../testing/mock-api.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

async function main() {
  const ROOT = process.cwd();
  const STATE_DIR = path.join(ROOT, ".sna");
  const args = process.argv.slice(2);

  let claudePath = "claude";
  const cachedPath = path.join(STATE_DIR, "claude-path");
  if (fs.existsSync(cachedPath)) {
    claudePath = fs.readFileSync(cachedPath, "utf8").trim() || claudePath;
  }

  const mock = await startMockAnthropicServer();
  const mockConfigDir = path.join(STATE_DIR, "mock-claude-oneshot");
  fs.mkdirSync(mockConfigDir, { recursive: true });

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TERM: process.env.TERM ?? "xterm-256color",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    ANTHROPIC_BASE_URL: `http://localhost:${mock.port}`,
    ANTHROPIC_API_KEY: "sk-test-mock-oneshot",
    CLAUDE_CONFIG_DIR: mockConfigDir,
  };

  // Capture stdout and stderr
  const stdoutPath = path.join(STATE_DIR, "mock-claude-stdout.log");
  const stderrPath = path.join(STATE_DIR, "mock-claude-stderr.log");

  const proc = spawn(claudePath, args, {
    env,
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); });
  proc.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });

  // Also pipe to console for real-time output
  proc.stdout!.pipe(process.stdout);

  proc.on("exit", (code) => {
    // Save logs
    fs.writeFileSync(stdoutPath, stdout);
    fs.writeFileSync(stderrPath, stderr);

    // Summary
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Mock API: ${mock.requests.length} request(s)`);
    for (const req of mock.requests) {
      console.log(`  model=${req.model} stream=${req.stream} messages=${req.messages?.length}`);
    }
    console.log(`\nLog files:`);
    console.log(`  stdout:   ${stdoutPath}`);
    console.log(`  stderr:   ${stderrPath}`);
    console.log(`  api log:  ${path.join(STATE_DIR, "mock-api-last-request.json")}`);
    console.log(`  config:   ${mockConfigDir}`);
    console.log(`  exit:     ${code}`);

    mock.close();
    process.exit(code ?? 0);
  });

  setTimeout(() => { proc.kill(); }, 60000);
}

main();
