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
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TERM: process.env.TERM ?? "xterm-256color",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    ANTHROPIC_BASE_URL: `http://localhost:${mock.port}`,
    ANTHROPIC_API_KEY: "sk-test-mock-oneshot",
    CLAUDE_CONFIG_DIR: mockConfigDir
  };
  const proc = spawn(claudePath, args, {
    env,
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"]
  });
  proc.on("exit", (code) => {
    console.log(`
\u2500\u2500 Mock API: ${mock.requests.length} request(s) \u2500\u2500`);
    for (const req of mock.requests) {
      console.log(`  model=${req.model} stream=${req.stream} messages=${req.messages?.length}`);
    }
    mock.close();
    process.exit(code ?? 0);
  });
  setTimeout(() => {
    proc.kill();
  }, 6e4);
}
main();
