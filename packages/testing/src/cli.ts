/**
 * sna-test CLI — testing utilities for SNA.
 *
 * Commands:
 *   sna-test claude [args...]     Launch Claude Code with mock API (args passed through)
 *   sna-test ls                   List test instances
 *   sna-test logs <name> [-f]     View instance logs
 *   sna-test rm <name|--all>      Remove instance(s)
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import {
  generateInstanceName,
  getInstanceDir,
  writeInstanceMeta,
  readInstanceMeta,
  listInstances,
  removeInstance,
  type InstanceMeta,
} from "./instance.js";
import { startMockAnthropicServer, type MockLogEntry } from "./mock-api.js";

const SHELL = process.env.SHELL || "/bin/zsh";

// ── Helpers ──────────────────────────────────────────────────────

function resolveClaudePath(): string {
  const stateDir = path.join(process.cwd(), ".sna");
  const cached = path.join(stateDir, "claude-path");
  if (fs.existsSync(cached)) {
    const p = fs.readFileSync(cached, "utf8").trim();
    if (p) {
      try { execSync(`test -x "${p}"`, { stdio: "pipe" }); return p; } catch { /* stale */ }
    }
  }
  try {
    const resolved = execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
    if (resolved) return resolved;
  } catch { /* not in PATH */ }
  for (const p of ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", `${process.env.HOME}/.local/bin/claude`]) {
    try { execSync(`test -x "${p}"`, { stdio: "pipe" }); return p; } catch { /* next */ }
  }
  return "claude";
}

function printInstanceInfo(name: string) {
  console.log();
  console.log(`  ${chalk.bold("instance:")}  ${chalk.cyan(name)}`);
  console.log();
  console.log(`  ${chalk.dim("all logs:")}   sna-test logs ${name}`);
  console.log(`  ${chalk.dim("follow:")}     sna-test logs ${name} -f`);
  console.log(`  ${chalk.dim("api logs:")}   sna-test logs ${name} --api`);
  console.log(`  ${chalk.dim("cleanup:")}    sna-test rm ${name}`);
  console.log();
}

function buildClaudeEnv(mockPort: number, instanceDir: string): Record<string, string> {
  const configDir = path.join(instanceDir, "claude-config");
  fs.mkdirSync(configDir, { recursive: true });

  const apiKey = "sk-test-mock-sna";
  const keyTruncated = apiKey.slice(-20);

  const configFile = path.join(configDir, ".claude.json");
  if (!fs.existsSync(configFile)) {
    const cwd = process.cwd();
    fs.writeFileSync(configFile, JSON.stringify({
      theme: "dark",
      hasCompletedOnboarding: true,
      customApiKeyResponses: {
        approved: [keyTruncated],
        rejected: [],
      },
      projects: {
        [cwd]: { hasTrustDialogAccepted: true },
      },
    }, null, 2));
  }

  return {
    ...process.env as Record<string, string>,
    ANTHROPIC_BASE_URL: `http://localhost:${mockPort}`,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_CONFIG_DIR: configDir,
  };
}

function wireApiLog(mock: ReturnType<typeof startMockAnthropicServer> extends Promise<infer T> ? T : never, dir: string) {
  const logPath = path.join(dir, "api.jsonl");
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  mock.onLog((line) => { stream.write(line + "\n"); });
  return { logPath, close: () => stream.end() };
}

function formatApiLogEntry(entry: MockLogEntry): string {
  const ts = chalk.dim(entry.ts.slice(11, 23));
  switch (entry.type) {
    case "request":
      return `${ts} ${chalk.yellow("REQ")}  ${entry.model ?? ""}  messages=${entry.messageCount ?? 0}  stream=${entry.stream ?? false}\n` +
        `${" ".repeat(14)}${chalk.dim("user:")} ${entry.userText ?? ""}` +
        (entry.systemPromptLength ? `\n${" ".repeat(14)}${chalk.dim("system:")} ${entry.systemPromptLength} chars` : "");
    case "response":
      return `${ts} ${chalk.green("RES")}  ${entry.model ?? ""}  stream=${entry.stream ?? false}\n` +
        `${" ".repeat(14)}${chalk.dim("reply:")} ${entry.replyText ?? ""}`;
    case "error":
      return `${ts} ${chalk.red("ERR")}  ${entry.method ?? ""} ${entry.url ?? ""}  ${entry.error ?? ""}`;
    case "info":
      return `${ts} ${chalk.blue("INFO")} ${entry.message ?? ""}`;
    default:
      return `${ts} ${JSON.stringify(entry)}`;
  }
}

// ── claude ────────────────────────────────────────────────────────

async function cmdClaude(args: string[]) {
  const name = generateInstanceName();
  const dir = getInstanceDir(name);
  fs.mkdirSync(dir, { recursive: true });

  const meta: InstanceMeta = {
    name,
    mode: args.includes("-p") || args.includes("--print") ? "oneshot" : "interactive",
    command: `sna-test claude ${args.join(" ")}`.trim(),
    createdAt: new Date().toISOString(),
    status: "running",
  };
  writeInstanceMeta(name, meta);

  printInstanceInfo(name);
  console.log(`  Starting mock API...`);

  const mock = await startMockAnthropicServer();
  meta.mockPort = mock.port;
  writeInstanceMeta(name, meta);
  const apiLog = wireApiLog(mock, dir);

  console.log(`  Mock API ready on :${mock.port}`);
  console.log();

  const claudePath = resolveClaudePath();
  const env = buildClaudeEnv(mock.port, dir);

  // All args passed straight through to Claude Code.
  // stdio: "inherit" — Claude gets the real TTY.
  const proc = spawn(claudePath, args, {
    env,
    cwd: process.cwd(),
    stdio: "inherit",
  });
  meta.pid = proc.pid;
  writeInstanceMeta(name, meta);

  proc.on("exit", (code) => {
    meta.exitCode = code;
    meta.status = code === 0 ? "done" : "error";
    meta.pid = undefined;
    writeInstanceMeta(name, meta);
    apiLog.close();

    console.log();
    console.log(`  ${chalk.dim("─".repeat(50))}`);
    console.log(`  ${chalk.bold("instance:")}  ${chalk.cyan(name)}  ${meta.status === "done" ? chalk.green("done") : chalk.red(`error (exit ${code})`)}`);
    console.log(`  ${chalk.dim("requests:")}  ${mock.requests.length}`);
    console.log(`  ${chalk.dim("logs:")}      sna-test logs ${name}`);
    console.log(`  ${chalk.dim("api logs:")}  sna-test logs ${name} --api`);
    console.log(`  ${chalk.dim("cleanup:")}   sna-test rm ${name}`);

    mock.close();
    process.exit(code ?? 0);
  });
}

// ── ls ───────────────────────────────────────────────────────────

function cmdLs() {
  const instances = listInstances();
  if (instances.length === 0) {
    console.log("  No instances. Run: sna-test claude");
    return;
  }
  console.log();
  for (const inst of instances) {
    const status = inst.status === "running" ? chalk.green("running")
      : inst.status === "done" ? chalk.dim("done")
      : chalk.red("error");
    const date = inst.createdAt.slice(0, 19).replace("T", " ");
    const exit = inst.exitCode != null ? `  exit=${inst.exitCode}` : "";
    console.log(`  ${chalk.cyan(inst.name.padEnd(20))} ${inst.mode.padEnd(12)} ${chalk.dim(date)}  ${status}${exit}`);
    if (inst.command) {
      console.log(`  ${" ".repeat(20)} ${chalk.dim(inst.command)}`);
    }
  }
  console.log();
}

// ── logs ──────────────────────────────────────────────────────────

function cmdLogs(name: string, args: string[]) {
  const meta = readInstanceMeta(name);
  if (!meta) {
    console.error(`  Instance "${name}" not found. Run: sna-test ls`);
    process.exit(1);
  }

  const dir = getInstanceDir(name);
  const follow = args.includes("-f") || args.includes("--follow");
  const apiOnly = args.includes("--api");

  // --api: parse and display JSONL api logs
  if (apiOnly) {
    const logFile = path.join(dir, "api.jsonl");
    if (!fs.existsSync(logFile)) { console.log("  No API logs."); return; }

    if (follow) {
      const tail = spawn("tail", ["-f", logFile], { stdio: ["ignore", "pipe", "inherit"] });
      tail.stdout!.on("data", (d: Buffer) => {
        for (const line of d.toString().split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry: MockLogEntry = JSON.parse(line);
            console.log(formatApiLogEntry(entry));
          } catch {
            console.log(line);
          }
        }
      });
      process.on("SIGINT", () => { tail.kill(); process.exit(0); });
      return;
    }

    const content = fs.readFileSync(logFile, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry: MockLogEntry = JSON.parse(line);
        console.log(formatApiLogEntry(entry));
      } catch {
        console.log(line);
      }
    }
    return;
  }

  // Default: show api logs (main useful output — stdout goes to terminal via inherit)
  const apiFile = path.join(dir, "api.jsonl");
  if (fs.existsSync(apiFile)) {
    if (follow) {
      const tail = spawn("tail", ["-f", apiFile], { stdio: ["ignore", "pipe", "inherit"] });
      tail.stdout!.on("data", (d: Buffer) => {
        for (const line of d.toString().split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry: MockLogEntry = JSON.parse(line);
            console.log(formatApiLogEntry(entry));
          } catch {
            console.log(line);
          }
        }
      });
      process.on("SIGINT", () => { tail.kill(); process.exit(0); });
      return;
    }

    const content = fs.readFileSync(apiFile, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry: MockLogEntry = JSON.parse(line);
        console.log(formatApiLogEntry(entry));
      } catch {
        console.log(line);
      }
    }
  } else {
    console.log("  (no logs yet)");
  }
}

// ── rm ───────────────────────────────────────────────────────────

function cmdRm(args: string[]) {
  if (args.includes("--all")) {
    const instances = listInstances();
    for (const inst of instances) {
      removeInstance(inst.name);
      console.log(`  removed ${inst.name}`);
    }
    if (instances.length === 0) console.log("  No instances to remove.");
    return;
  }

  const name = args[0];
  if (!name) {
    console.error("  Usage: sna-test rm <name|--all>");
    process.exit(1);
  }

  if (removeInstance(name)) {
    console.log(`  removed ${name}`);
  } else {
    console.error(`  Instance "${name}" not found.`);
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case "claude":
    cmdClaude(args.slice(1));
    break;
  case "ls":
    cmdLs();
    break;
  case "logs": {
    const name = args[1];
    if (!name) { console.error("  Usage: sna-test logs <name> [-f] [--api]"); process.exit(1); }
    cmdLogs(name, args.slice(2));
    break;
  }
  case "rm":
    cmdRm(args.slice(1));
    break;
  default:
    console.log(`
  ${chalk.bold("sna-test")} — Testing utilities for SNA

  ${chalk.dim("Commands:")}
    sna-test claude [args...]        Launch Claude Code with mock Anthropic API
    sna-test claude -p "prompt"      Print mode (oneshot, non-interactive)
    sna-test ls                      List test instances
    sna-test logs <name>             View API request/response logs (parsed JSONL)
    sna-test logs <name> -f          Follow logs in real-time
    sna-test logs <name> --api       Same as default (explicit)
    sna-test rm <name>               Remove an instance
    sna-test rm --all                Remove all instances

  ${chalk.dim("Examples:")}
    sna-test claude                              Interactive TUI session
    sna-test claude -p "[tool:Bash] echo hello"  Test tool_use flow
    sna-test claude --permission-mode default     Test with specific permission mode
`);
}
