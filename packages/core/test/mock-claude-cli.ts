/**
 * Mock Claude Code CLI.
 *
 * Real `claude` binary: long-lived process speaking stream-json over stdio,
 * talks out to Anthropic API. For tests that exercise Claude provider spawn
 * logic, we only care about the CLI invocation — what flags/args did the
 * provider pass us? — not the actual LLM call.
 *
 * This stub:
 *   1. Responds to `--version` so validateClaudePath passes.
 *   2. Otherwise logs its argv to a JSON file and exits cleanly after a short
 *      grace period (reads stdin to detect EOF, then terminates).
 *
 * Point at it via `SNA_CLAUDE_COMMAND=<path>`; tests read the logged argv to
 * assert the adapter produced the expected --resume, --settings, --model etc.
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface MockClaudeCli {
  /** Absolute path used as SNA_CLAUDE_COMMAND. */
  command: string;
  /** File path where each invocation appends {argv, cwd, env} as JSONL. */
  invocationsLog: string;
  /** Parsed log snapshot. */
  readInvocations(): Array<{ argv: string[]; cwd: string; env: Record<string, string | undefined> }>;
  /** Find a specific CLI flag's value. Returns the argument after the flag name. */
  flagValue(argv: string[], flag: string): string | null;
  /** Drop all captured invocations. */
  reset(): void;
  close(): void;
}

const STUB_SCRIPT = `
const fs = require("fs");
const argv = process.argv.slice(2);
const log = process.env.CLAUDE_MOCK_LOG;

if (argv[0] === "--version") {
  process.stdout.write("2.0.0 (Claude Code Mock)\\n");
  process.exit(0);
}

if (log) {
  try {
    const rec = {
      argv,
      cwd: process.cwd(),
      env: {
        SNA_SESSION_ID: process.env.SNA_SESSION_ID,
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      },
    };
    fs.appendFileSync(log, JSON.stringify(rec) + "\\n");
  } catch {}
}

// Keep alive briefly so the spawning process can finish its setup. Exit on
// stdin EOF or after a short timer, whichever comes first.
const timer = setTimeout(() => process.exit(0), 200);
process.stdin.on("end", () => { clearTimeout(timer); process.exit(0); });
process.stdin.resume();
`;

let stubPath: string | null = null;

function ensureStub(): string {
  if (stubPath && fs.existsSync(stubPath)) return stubPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-claude-cli-"));
  stubPath = path.join(dir, "mock-claude-cli.js");
  fs.writeFileSync(stubPath, STUB_SCRIPT);
  return stubPath;
}

export function startMockClaudeCli(): MockClaudeCli {
  const script = ensureStub();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-claude-cli-log-"));
  const invocationsLog = path.join(logDir, "invocations.jsonl");
  fs.writeFileSync(invocationsLog, "");

  const wrapperPath = path.join(logDir, "claude");
  fs.writeFileSync(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "--version" ]; then',
      '  echo "2.0.0 (Claude Code Mock)"',
      "  exit 0",
      "fi",
      `exec env CLAUDE_MOCK_LOG="${invocationsLog}" node "${script}" "$@"`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(wrapperPath, 0o755);

  return {
    command: wrapperPath,
    invocationsLog,
    readInvocations() {
      const raw = fs.readFileSync(invocationsLog, "utf8");
      return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    },
    flagValue(argv: string[], flag: string) {
      const idx = argv.indexOf(flag);
      if (idx < 0 || idx + 1 >= argv.length) return null;
      return argv[idx + 1];
    },
    reset() {
      fs.writeFileSync(invocationsLog, "");
    },
    close() {
      try { fs.rmSync(logDir, { recursive: true, force: true }); } catch {}
    },
  };
}
