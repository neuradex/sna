/**
 * sna.ts — LLM-Native Application lifecycle manager
 *
 * Core primitive for every SNA project.
 * Manages the full environment: DB init, web server, background processes.
 *
 * Commands:
 *   sna up      — start all services
 *   sna down    — stop all services
 *   sna status  — show running services
 *   sna restart — down + up
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { cmdNew, cmdWorkflow } from "./workflow.js";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".sna");
const PID_FILE = path.join(STATE_DIR, "server.pid");
const PORT_FILE = path.join(STATE_DIR, "port");
const LOG_FILE = path.join(STATE_DIR, "server.log");

const PORT = process.env.PORT ?? "3000";
const WS_PORT = "3001";
const DB_PATH = path.join(ROOT, "data/app.db");
const WS_PID_FILE = path.join(STATE_DIR, "terminal.pid");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");

const SNA_CORE_DIR = path.join(ROOT, "node_modules/sna");

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, "utf8").trim();
  const pid = parseInt(raw);
  return isNaN(pid) ? null : pid;
}

function writePid(pid: number) {
  ensureStateDir();
  fs.writeFileSync(PID_FILE, String(pid));
  fs.writeFileSync(PORT_FILE, String(PORT));
}

function clearState() {
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
}

function isPortInUse(port: string): boolean {
  try {
    execSync(`lsof -ti:${port}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function resolveAndCacheClaudePath(): string {
  const SHELL = process.env.SHELL || "/bin/zsh";
  const candidates = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
  ];
  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      fs.writeFileSync(CLAUDE_PATH_FILE, p);
      return p;
    } catch { /* not found */ }
  }
  try {
    const resolved = execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
    fs.writeFileSync(CLAUDE_PATH_FILE, resolved);
    return resolved;
  } catch {
    return "claude";
  }
}

function openBrowser(url: string) {
  try {
    execSync(`open "${url}"`, { stdio: "ignore" });
  } catch {
    // non-mac, skip
  }
}

// ── commands ──────────────────────────────────────────────────────────────────

function step(label: string) {
  console.log(`  ✓  ${label}`);
}

function cmdUp() {
  console.log("▶  Skills-Native App — startup\n");

  // 1. Check if already running
  const existingPid = readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    const port = fs.existsSync(PORT_FILE)
      ? fs.readFileSync(PORT_FILE, "utf8").trim()
      : PORT;
    console.log(`Already running (pid=${existingPid})`);
    console.log(`→  http://localhost:${port}`);
    return;
  }

  // 2. Check Node / pnpm available
  try {
    const node = execSync("node --version", { encoding: "utf8" }).trim();
    const pnpmVersion = execSync("pnpm --version", { encoding: "utf8" }).trim();
    step(`Node ${node}  /  pnpm ${pnpmVersion}`);
  } catch {
    console.error("\n✗  Node.js or pnpm not found.");
    console.error("   Install Node.js: https://nodejs.org");
    console.error("   Then: npm install -g pnpm");
    process.exit(1);
  }

  // 3. Install dependencies if node_modules missing or package.json newer
  const nmPath = path.join(ROOT, "node_modules");
  const pkgPath = path.join(ROOT, "package.json");
  const needsInstall =
    !fs.existsSync(nmPath) ||
    fs.statSync(pkgPath).mtimeMs > fs.statSync(nmPath).mtimeMs;

  if (needsInstall) {
    process.stdout.write("  …  Installing dependencies");
    try {
      execSync("pnpm install --frozen-lockfile", { cwd: ROOT, stdio: "pipe" });
      console.log("\r  ✓  Dependencies installed          ");
    } catch {
      execSync("pnpm install", { cwd: ROOT, stdio: "pipe" });
      console.log("\r  ✓  Dependencies installed          ");
    }
  } else {
    step("Dependencies ready");
  }

  // 4. Init .claude/settings.json
  cmdInit();

  // 5. Init DB if needed
  if (!fs.existsSync(DB_PATH)) {
    process.stdout.write("  …  Setting up database");
    execSync("pnpm db:init", { cwd: ROOT, stdio: "pipe" });
    console.log("\r  ✓  Database initialized              ");
  } else {
    step("Database ready");
  }

  // 5. Kill anything already on the web port
  if (isPortInUse(PORT)) {
    process.stdout.write(`  …  Port ${PORT} busy — freeing`);
    try { execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: "pipe" }); } catch { /* ignore */ }
    console.log(`\r  ✓  Port ${PORT} cleared              `);
  }

  // 6. Ensure node-pty spawn-helper is executable
  const spawnHelper = path.join(ROOT, "node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
  if (fs.existsSync(spawnHelper)) {
    const mode = fs.statSync(spawnHelper).mode;
    if ((mode & 0o111) === 0) {
      fs.chmodSync(spawnHelper, 0o755);
      step("node-pty spawn-helper permissions fixed");
    }
  }

  // 7. Kill WS port if busy
  if (isPortInUse(WS_PORT)) {
    try { execSync(`lsof -ti:${WS_PORT} | xargs kill -9`, { stdio: "pipe" }); } catch { /* ignore */ }
  }

  // 8. Resolve + cache claude binary path
  ensureStateDir();
  const claudePath = resolveAndCacheClaudePath();
  step(`Claude binary: ${claudePath}`);

  // 9. Spawn terminal WebSocket server (from sna)
  const wsLog = fs.openSync(path.join(STATE_DIR, "terminal.log"), "w");
  const wsChild = spawn("node", [path.join(SNA_CORE_DIR, "dist/server/terminal.js")], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", wsLog, wsLog],
  });
  wsChild.unref();
  fs.writeFileSync(WS_PID_FILE, String(wsChild.pid!));
  step("Terminal WebSocket server starting");

  // 10. Spawn dev server (app defines its own `pnpm dev`)
  const logStream = fs.openSync(LOG_FILE, "w");
  const child = spawn("pnpm", ["dev"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    env: { ...process.env, PORT },
  });
  child.unref();
  writePid(child.pid!);

  // 11. Wait for server ready
  process.stdout.write("  …  Starting web server");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    execSync("sleep 1");
    if (isPortInUse(PORT)) { ready = true; break; }
    process.stdout.write(".");
  }
  console.log(ready
    ? "\r  ✓  Web server running                    "
    : "\r  △  Web server starting (check .sna/server.log)");

  // 12. Open browser
  const url = `http://localhost:${PORT}`;
  openBrowser(url);

  console.log(`
✓  SNA is up

   App  →  ${url}

   Logs: .sna/server.log`);
}

function cmdDown() {
  console.log("■  Stopping Skills-Native App...\n");

  const pid = readPid();

  if (!pid) {
    console.log("   Not running (no PID file)");
    clearState();
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log("   Process already gone");
    clearState();
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }

  let freed = false;
  for (let i = 0; i < 10; i++) {
    execSync("sleep 0.5");
    if (!isPortInUse(PORT)) { freed = true; break; }
  }

  if (fs.existsSync(WS_PID_FILE)) {
    const wsPid = parseInt(fs.readFileSync(WS_PID_FILE, "utf8").trim());
    if (!isNaN(wsPid) && isProcessRunning(wsPid)) {
      try { process.kill(-wsPid, "SIGTERM"); } catch { try { process.kill(wsPid, "SIGKILL"); } catch { /* gone */ } }
    }
    fs.unlinkSync(WS_PID_FILE);
    console.log(`   Terminal WS ✓  (pid=${wsPid} stopped)`);
  }

  clearState();
  console.log(`   Web server  ✓  (pid=${pid} stopped)`);
  if (!freed) console.log(`   Note: port ${PORT} may still be in use briefly`);
  console.log("\n✓  SNA is down");
}

function cmdStatus() {
  const pid = readPid();
  const port = fs.existsSync(PORT_FILE)
    ? fs.readFileSync(PORT_FILE, "utf8").trim()
    : PORT;

  console.log("── SNA Status ──────────────────");

  if (pid && isProcessRunning(pid)) {
    console.log(`  Web server   ✓  running  (pid=${pid}, port=${port})`);
    console.log(`  URL          http://localhost:${port}`);
  } else {
    console.log(`  Web server   ✗  stopped`);
    if (pid) clearState();
  }

  if (fs.existsSync(DB_PATH)) {
    const stat = fs.statSync(DB_PATH);
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`  Database     ✓  ${kb} KB  (${DB_PATH})`);
  } else {
    console.log(`  Database     ✗  not initialized`);
  }

  console.log("────────────────────────────────");
}

function cmdInit(force = false) {
  console.log(`▶  SNA — project init${force ? " (--force)" : ""}\n`);

  const claudeDir = path.join(ROOT, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const hookCommand = `node "$CLAUDE_PROJECT_DIR"/node_modules/sna/dist/scripts/hook.js`;

  const permissionHook = {
    matcher: ".*",
    hooks: [{ type: "command", async: true, command: hookCommand }],
  };

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch { /* start fresh if malformed */ }
  }

  // Merge PermissionRequest hook — avoid duplicates
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const existing = (hooks.PermissionRequest ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
  const alreadySet = existing.some((entry) =>
    entry.hooks?.some((h) => h.command === hookCommand)
  );

  if (!alreadySet) {
    hooks.PermissionRequest = [...existing, permissionHook];
    settings.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    step(".claude/settings.json — PermissionRequest hook registered");
  } else {
    step(".claude/settings.json — hook already set, skipped");
  }

  // Copy CLAUDE.md template → .claude/CLAUDE.md
  const claudeMdTemplate = path.join(ROOT, "node_modules/sna/CLAUDE.md.template");
  const claudeMdDest = path.join(claudeDir, "CLAUDE.md");
  if (fs.existsSync(claudeMdTemplate)) {
    if (force || !fs.existsSync(claudeMdDest)) {
      fs.copyFileSync(claudeMdTemplate, claudeMdDest);
      step(".claude/CLAUDE.md — created");
    } else {
      step(".claude/CLAUDE.md — already exists, skipped");
    }
  }

  // Copy bundled skills from sna package → .claude/skills/
  const snaCoreSkillsDir = path.join(ROOT, "node_modules/sna/skills");
  const destSkillsDir = path.join(claudeDir, "skills");

  if (fs.existsSync(snaCoreSkillsDir)) {
    const skillNames = fs.readdirSync(snaCoreSkillsDir);
    for (const skillName of skillNames) {
      const src = path.join(snaCoreSkillsDir, skillName, "SKILL.md");
      if (!fs.existsSync(src)) continue;
      const destDir = path.join(destSkillsDir, skillName);
      const dest = path.join(destDir, "SKILL.md");
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      if (force || !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        step(`.claude/skills/${skillName}/SKILL.md — installed`);
      } else {
        step(`.claude/skills/${skillName}/SKILL.md — already exists, skipped`);
      }
    }
  }

  console.log("\n✓  SNA init complete");
}

// ── help ──────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`sna — Skills-Native Application CLI

Usage:
  sna <command> [options]

Lifecycle:
  sna up              Start all services (DB, WebSocket, dev server)
  sna down            Stop all services
  sna status          Show running services
  sna restart         Stop + start
  sna init [--force]  Initialize .claude/settings.json and skills

Workflow:
  sna new <skill> [--param val ...]    Create a task from a workflow.yml
  sna <task-id> start                  Resume a paused task
  sna <task-id> next [--key val]       Submit scalar data (CLI flags)
  sna <task-id> next <<'EOF' ... EOF   Submit structured data (stdin JSON)

  Task IDs are 10-digit timestamps (MMDDHHmmss), e.g. 0317143052

Run "sna help workflow" for workflow.yml specification.
Run "sna help submit" for data submission patterns.`);
}

function printWorkflowHelp() {
  console.log(`sna help workflow — workflow.yml specification

A workflow defines the steps a skill must follow. The CLI enforces
step ordering, data validation, and event emission automatically.

Location:
  .claude/skills/<skill-name>/workflow.yml

Structure:
  version: 1
  skill: <skill-name>

  params:                          # CLI flags for "sna new"
    query:
      type: string                 # string | integer | number | boolean
      required: true

  steps:                           # executed in order
    - id: <unique-id>
      name: "Step display name"

      # === Step type A: exec (CLI auto-executes) ===
      exec: "curl -s http://..."   # shell command, {{param}} interpolated
      extract:                     # parse JSON response into context
        field_name: ".json_key"    # jq-like: ".key", "[.[] | .key]", "."
      event: "Message with {{field_name}}"  # emitted as milestone

      # === Step type B: instruction (model does work) ===
      instruction: |               # displayed to the model
        Do this task. Use {{param}} from context.

      # --- Option 1: structured data via stdin JSON ---
      submit:
        type: array                # array | object
        items:                     # field definitions
          company_name: { type: string, required: true }
          url: { type: string, required: true }
          notes: { type: string }  # required defaults to false
      handler: |                   # CLI executes with {{submitted}} = JSON string
        curl -s -X POST http://localhost:3000/api/endpoint \\
          -H 'Content-Type: application/json' -d '{{submitted}}'
      extract:                     # parse handler response into context
        registered: ".registered"
      event: "{{registered}} items processed"

      # --- Option 2: scalar values via CLI flags ---
      data:
        - key: count
          when: after
          type: integer            # string | integer | number | boolean | json
          label: "件数"
      event: "{{count}} items found"

  complete: "Done: {{field}}"      # interpolated with context
  error: "Failed: {{error}}"       # {{error}} is auto-set on failure

Execution rules:
  - exec steps auto-chain: if multiple exec steps are consecutive,
    CLI runs them all without stopping.
  - instruction steps pause: CLI displays the instruction and waits
    for "sna <id> next" with the required data.
  - Events are emitted to SQLite skill_events automatically.
  - Task state is saved to .sna/tasks/<id>.json after each step.`);
}

function printSubmitHelp() {
  console.log(`sna help submit — data submission patterns

Workflow steps can receive data in two ways:

1. Structured data (stdin JSON) — for complex/bulk data
   Used when the step has "submit" + "handler" in workflow.yml.

   The model submits JSON via stdin:
     sna <task-id> next <<'EOF'
     [
       {"company_name": "Foo Corp", "url": "https://foo.co", "form_url": "https://foo.co/contact"},
       {"company_name": "Bar Inc", "url": "https://bar.io", "form_url": "https://bar.io/inquiry"}
     ]
     EOF

   Flow:
     stdin JSON → CLI validates against submit schema
                → CLI executes handler (e.g. curl to app API)
                → CLI extracts fields from API response
                → fields saved to task context
                → event emitted with interpolated message

   The handler template uses {{submitted}} for the raw JSON string.
   The API response is parsed and fields are extracted via "extract".
   The API is the source of truth — not the model's self-report.

2. Scalar values (CLI flags) — for simple key-value pairs
   Used when the step has "data" with "when: after" in workflow.yml.

     sna <task-id> next --registered-count 8 --skipped-count 3

   Flags use --kebab-case, mapped to snake_case context keys.
   Each value is validated against the declared type.

Validation errors:
  - Missing required fields → error + re-display expected format
  - Wrong types (e.g. "abc" for integer) → error + expected format
  - Empty stdin when submit is expected → error + JSON example
  - Invalid JSON → error + JSON example`);
}

// ── router ────────────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;
const force = args.includes("--force");
const wantsHelp = args.includes("--help") || args.includes("-h");
const isTaskId = /^\d{10}[a-z]?$/.test(command ?? "");

if (command === "help" || command === "--help" || command === "-h" || (!command && !isTaskId)) {
  const topic = args[0];
  if (topic === "workflow") printWorkflowHelp();
  else if (topic === "submit") printSubmitHelp();
  else printHelp();
} else if (command === "new") {
  if (wantsHelp) {
    console.log(`Usage: sna new <skill> [--param val ...]

Create a new task from .claude/skills/<skill>/workflow.yml.
Exec steps are auto-executed. Stops at the first instruction step.

Example:
  sna new company-search --query "東京のSaaS企業"

Run "sna help workflow" for workflow.yml specification.`);
  } else {
    cmdNew(args);
  }
} else if (isTaskId) {
  if (wantsHelp) {
    console.log(`Usage: sna <task-id> <start|next> [options]

Commands:
  sna <id> start                   Resume task from current step
  sna <id> next --key val          Submit scalar values
  sna <id> next <<'EOF' ... EOF    Submit JSON via stdin

Task state: .sna/tasks/<id>.json

Run "sna help submit" for data submission patterns.`);
  } else {
    cmdWorkflow(command!, args);
  }
} else {
  switch (command) {
    case "init":    cmdInit(force);   break;
    case "up":      cmdUp();     break;
    case "down":    cmdDown();   break;
    case "status":  cmdStatus(); break;
    case "restart":
      cmdDown();
      console.log();
      cmdUp();
      break;
    default:
      printHelp();
  }
}
