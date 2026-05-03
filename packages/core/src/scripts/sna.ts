#!/usr/bin/env node
/**
 * sna.ts — CLI entry point for spawning Claude Code with mock API support.
 *
 * Used by agent-integration.test.ts to test Claude Code via a mock Anthropic API server.
 *
 * Usage:
 *   node --import tsx src/scripts/sna.ts tu claude [claude-args...]
 *
 * When a `.sna/mock-api.port` file exists in the current directory, this script
 * sets ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY to redirect Claude Code to the
 * mock server.
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";

function parseArgs(argv: string[]): {
  claudeArgs: string[];
  claudeCommand: string;
} {
  const args: string[] = [];
  let i = 0;

  // Skip "node" and script path
  // Handle --import tsx (2 extra args)
  i = 2;
  if (argv[i] === "--import" && i + 1 < argv.length) {
    i += 2;
  }

  // Parse subcommand: "tu claude"
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

  // Forward remaining args to Claude Code
  args.push(...argv.slice(i));

  return { claudeArgs: args, claudeCommand: claudeCmd };
}

function main() {
  const { claudeArgs, claudeCommand } = parseArgs(process.argv);

  const cwd = process.cwd();
  const mockPortFile = path.join(cwd, ".sna/mock-api.port");
  const mockPort = fs.existsSync(mockPortFile)
    ? fs.readFileSync(mockPortFile, "utf8").trim()
    : null;

  const env = { ...process.env } as Record<string, string>;

  // Route through mock API if port file exists
  if (mockPort) {
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mockPort}`;
    env.ANTHROPIC_API_KEY = "test-key";
  }

  // Clean up Claude Code env vars that might interfere
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;

  // Resolve Claude Code CLI path
  let claudePath: string;
  try {
    const raw = execSync("command -v claude", { encoding: "utf8", stdio: "pipe" }).trim();
    claudePath = raw || "claude";
  } catch {
    claudePath = "claude";
  }

  const claudeParts = claudePath.split(/\s+/);
  const claudeBin = claudeParts[0]!;
  const claudePrefix = claudeParts.slice(1);

  const claudeDir = path.dirname(claudeBin);
  if (claudeDir && claudeDir !== ".") {
    env.PATH = `${claudeDir}:${env.PATH ?? ""}`;
  }

  const proc = spawn(claudeBin, [...claudePrefix, ...claudeArgs], {
    cwd,
    env,
    stdio: ["inherit", "inherit", "inherit"],
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
