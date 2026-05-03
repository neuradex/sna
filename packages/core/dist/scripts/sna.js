#!/usr/bin/env node
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
function parseArgs(argv) {
  const args = [];
  let i = 0;
  i = 2;
  if (argv[i] === "--import" && i + 1 < argv.length) {
    i += 2;
  }
  const subcommand = argv[i];
  if (subcommand !== "tu") {
    console.error("Usage: sna tu claude [claude-args...]");
    process.exit(1);
  }
  i++;
  const claudeCmd = argv[i];
  if (claudeCmd !== "claude") {
    console.error("Expected 'claude' subcommand, got:", claudeCmd);
    process.exit(1);
  }
  i++;
  args.push(...argv.slice(i));
  return { claudeArgs: args, claudeCommand: claudeCmd };
}
function main() {
  const { claudeArgs, claudeCommand } = parseArgs(process.argv);
  const cwd = process.cwd();
  const mockPortFile = path.join(cwd, ".sna/mock-api.port");
  const mockPort = fs.existsSync(mockPortFile) ? fs.readFileSync(mockPortFile, "utf8").trim() : null;
  const env = { ...process.env };
  if (mockPort) {
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mockPort}`;
    env.ANTHROPIC_API_KEY = "test-key";
  }
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  let claudePath;
  try {
    const raw = execSync("command -v claude", { encoding: "utf8", stdio: "pipe" }).trim();
    claudePath = raw || "claude";
  } catch {
    claudePath = "claude";
  }
  const claudeParts = claudePath.split(/\s+/);
  const claudeBin = claudeParts[0];
  const claudePrefix = claudeParts.slice(1);
  const claudeDir = path.dirname(claudeBin);
  if (claudeDir && claudeDir !== ".") {
    env.PATH = `${claudeDir}:${env.PATH ?? ""}`;
  }
  const proc = spawn(claudeBin, [...claudePrefix, ...claudeArgs], {
    cwd,
    env,
    stdio: ["inherit", "inherit", "inherit"]
  });
  proc.on("error", (err) => {
    console.error("Claude Code spawn error:", err.message);
    process.exit(1);
  });
  proc.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}
main();
