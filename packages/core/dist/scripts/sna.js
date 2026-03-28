import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { cmdNew, cmdWorkflow, cmdCancel, cmdTasks } from "./workflow.js";
const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".sna");
const PID_FILE = path.join(STATE_DIR, "server.pid");
const PORT_FILE = path.join(STATE_DIR, "port");
const LOG_FILE = path.join(STATE_DIR, "server.log");
const SNA_API_PID_FILE = path.join(STATE_DIR, "sna-api.pid");
const SNA_API_PORT_FILE = path.join(STATE_DIR, "sna-api.port");
const SNA_API_LOG_FILE = path.join(STATE_DIR, "sna-api.log");
const PORT = process.env.PORT ?? "3000";
const DB_PATH = path.join(ROOT, "data/app.db");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");
const SNA_CORE_DIR = path.join(ROOT, "node_modules/sna");
function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function readPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = fs.readFileSync(PID_FILE, "utf8").trim();
  const pid = parseInt(raw);
  return isNaN(pid) ? null : pid;
}
function writePid(pid) {
  ensureStateDir();
  fs.writeFileSync(PID_FILE, String(pid));
  fs.writeFileSync(PORT_FILE, String(PORT));
}
function clearState() {
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
}
function readSnaApiPid() {
  if (!fs.existsSync(SNA_API_PID_FILE)) return null;
  const raw = fs.readFileSync(SNA_API_PID_FILE, "utf8").trim();
  const pid = parseInt(raw);
  return isNaN(pid) ? null : pid;
}
function readSnaApiPort() {
  if (!fs.existsSync(SNA_API_PORT_FILE)) return null;
  return fs.readFileSync(SNA_API_PORT_FILE, "utf8").trim() || null;
}
function clearSnaApiState() {
  for (const f of [SNA_API_PID_FILE, SNA_API_PORT_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
function findFreePort() {
  const net = require("net");
  const srv = net.createServer();
  srv.listen(0);
  const port = String(srv.address().port);
  srv.close();
  return port;
}
async function checkSnaApiHealth(port) {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2e3)
    });
    const json = await res.json();
    return json.name === "sna";
  } catch {
    return false;
  }
}
async function cmdApiUp() {
  const standaloneEntry = path.join(SNA_CORE_DIR, "dist/server/standalone.js");
  const existingPort = process.env.SNA_PORT ?? readSnaApiPort();
  if (existingPort && isPortInUse(existingPort)) {
    const healthy = await checkSnaApiHealth(existingPort);
    if (healthy) {
      step(`SNA API already running on :${existingPort} \u2014 reusing`);
      return;
    }
  }
  if (!fs.existsSync(standaloneEntry)) {
    console.error(`
\u2717  SNA standalone server not found: ${standaloneEntry}`);
    console.error(`   Run "pnpm build" in sna-core.
`);
    process.exit(1);
  }
  const staleApiPid = readSnaApiPid();
  if (staleApiPid && isProcessRunning(staleApiPid)) {
    try {
      process.kill(staleApiPid, "SIGTERM");
    } catch {
    }
  }
  const port = process.env.SNA_PORT ?? (existingPort && !isPortInUse(existingPort) ? existingPort : findFreePort());
  ensureStateDir();
  const logStream = fs.openSync(SNA_API_LOG_FILE, "w");
  const child = spawn("node", [standaloneEntry], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    env: { ...process.env, SNA_PORT: port }
  });
  child.unref();
  fs.writeFileSync(SNA_API_PID_FILE, String(child.pid));
  fs.writeFileSync(SNA_API_PORT_FILE, port);
  step(`SNA API server \u2192 http://localhost:${port}`);
}
function cmdApiDown() {
  const pid = readSnaApiPid();
  const port = readSnaApiPort();
  if (pid && isProcessRunning(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
    }
    for (let i = 0; i < 6; i++) {
      if (!isProcessRunning(pid)) break;
      execSync("sleep 0.5", { stdio: "pipe" });
    }
    if (isProcessRunning(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
      }
    }
    console.log(`   SNA API     \u2713  stopped (pid=${pid})`);
  } else {
    console.log(`   SNA API     \u2014  not running`);
  }
  if (port) {
    try {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: "pipe" });
    } catch {
    }
  }
  clearSnaApiState();
}
function isPortInUse(port) {
  try {
    execSync(`lsof -ti:${port}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function resolveAndCacheClaudePath() {
  const SHELL = process.env.SHELL || "/bin/zsh";
  const candidates = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`
  ];
  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      fs.writeFileSync(CLAUDE_PATH_FILE, p);
      return p;
    } catch {
    }
  }
  try {
    const resolved = execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
    fs.writeFileSync(CLAUDE_PATH_FILE, resolved);
    return resolved;
  } catch {
    return "claude";
  }
}
function openBrowser(url) {
  try {
    execSync(`open "${url}"`, { stdio: "ignore" });
  } catch {
  }
}
function step(label) {
  console.log(`  \u2713  ${label}`);
}
function cmdUp() {
  console.log("\u25B6  Skills-Native App \u2014 startup\n");
  const existingPid = readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    const port = fs.existsSync(PORT_FILE) ? fs.readFileSync(PORT_FILE, "utf8").trim() : PORT;
    console.log(`Already running (pid=${existingPid})`);
    console.log(`\u2192  http://localhost:${port}`);
    return;
  }
  try {
    const node = execSync("node --version", { encoding: "utf8" }).trim();
    const pnpmVersion = execSync("pnpm --version", { encoding: "utf8" }).trim();
    step(`Node ${node}  /  pnpm ${pnpmVersion}`);
  } catch {
    console.error("\n\u2717  Node.js or pnpm not found.");
    console.error("   Install Node.js: https://nodejs.org");
    console.error("   Then: npm install -g pnpm");
    process.exit(1);
  }
  const nmPath = path.join(ROOT, "node_modules");
  const pkgPath = path.join(ROOT, "package.json");
  const needsInstall = !fs.existsSync(nmPath) || fs.statSync(pkgPath).mtimeMs > fs.statSync(nmPath).mtimeMs;
  if (needsInstall) {
    process.stdout.write("  \u2026  Installing dependencies");
    try {
      execSync("pnpm install --frozen-lockfile", { cwd: ROOT, stdio: "pipe" });
      console.log("\r  \u2713  Dependencies installed          ");
    } catch {
      execSync("pnpm install", { cwd: ROOT, stdio: "pipe" });
      console.log("\r  \u2713  Dependencies installed          ");
    }
  } else {
    step("Dependencies ready");
  }
  cmdInit();
  if (!fs.existsSync(DB_PATH)) {
    process.stdout.write("  \u2026  Setting up database");
    execSync("pnpm db:init", { cwd: ROOT, stdio: "pipe" });
    console.log("\r  \u2713  Database initialized              ");
  } else {
    step("Database ready");
  }
  if (isPortInUse(PORT)) {
    process.stdout.write(`  \u2026  Port ${PORT} busy \u2014 freeing`);
    try {
      execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: "pipe" });
    } catch {
    }
    console.log(`\r  \u2713  Port ${PORT} cleared              `);
  }
  ensureStateDir();
  const claudePath = resolveAndCacheClaudePath();
  step(`Claude binary: ${claudePath}`);
  const standaloneEntry = path.join(SNA_CORE_DIR, "dist/server/standalone.js");
  if (fs.existsSync(standaloneEntry)) {
    const staleApiPid = readSnaApiPid();
    const staleApiPort = readSnaApiPort();
    if (staleApiPid && isProcessRunning(staleApiPid)) {
      try {
        process.kill(staleApiPid, "SIGTERM");
      } catch {
      }
    }
    if (staleApiPort && isPortInUse(staleApiPort)) {
      try {
        execSync(`lsof -ti:${staleApiPort} | xargs kill -9`, { stdio: "pipe" });
      } catch {
      }
    }
    const snaApiPort = process.env.SNA_PORT ?? findFreePort();
    const snaApiLogStream = fs.openSync(SNA_API_LOG_FILE, "w");
    const snaApiChild = spawn("node", [standaloneEntry], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", snaApiLogStream, snaApiLogStream],
      env: { ...process.env, SNA_PORT: snaApiPort }
    });
    snaApiChild.unref();
    ensureStateDir();
    fs.writeFileSync(SNA_API_PID_FILE, String(snaApiChild.pid));
    fs.writeFileSync(SNA_API_PORT_FILE, snaApiPort);
    step(`SNA API server \u2192 http://localhost:${snaApiPort}`);
  }
  const logStream = fs.openSync(LOG_FILE, "w");
  const child = spawn("pnpm", ["dev"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    env: { ...process.env, PORT }
  });
  child.unref();
  writePid(child.pid);
  process.stdout.write("  \u2026  Starting web server");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    execSync("sleep 1");
    if (isPortInUse(PORT)) {
      ready = true;
      break;
    }
    process.stdout.write(".");
  }
  console.log(ready ? "\r  \u2713  Web server running                    " : "\r  \u25B3  Web server starting (check .sna/server.log)");
  const url = `http://localhost:${PORT}`;
  openBrowser(url);
  console.log(`
\u2713  SNA is up

   App  \u2192  ${url}

   Logs: .sna/server.log`);
}
function cmdDown() {
  console.log("\u25A0  Stopping Skills-Native App...\n");
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
    try {
      process.kill(pid, "SIGKILL");
    } catch {
    }
  }
  let freed = false;
  for (let i = 0; i < 10; i++) {
    execSync("sleep 0.5");
    if (!isPortInUse(PORT)) {
      freed = true;
      break;
    }
  }
  clearState();
  console.log(`   Web server  \u2713  (pid=${pid} stopped)`);
  if (!freed) console.log(`   Note: port ${PORT} may still be in use briefly`);
  const snaApiPid = readSnaApiPid();
  if (snaApiPid && isProcessRunning(snaApiPid)) {
    try {
      process.kill(snaApiPid, "SIGTERM");
    } catch {
    }
    console.log(`   SNA API     \u2713  (pid=${snaApiPid} stopped)`);
  }
  clearSnaApiState();
  console.log("\n\u2713  SNA is down");
}
function cmdStatus() {
  const pid = readPid();
  const port = fs.existsSync(PORT_FILE) ? fs.readFileSync(PORT_FILE, "utf8").trim() : PORT;
  console.log("\u2500\u2500 SNA Status \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (pid && isProcessRunning(pid)) {
    console.log(`  Web server   \u2713  running  (pid=${pid}, port=${port})`);
    console.log(`  URL          http://localhost:${port}`);
  } else {
    console.log(`  Web server   \u2717  stopped`);
    if (pid) clearState();
  }
  const snaApiPid = readSnaApiPid();
  const snaApiPort = readSnaApiPort();
  if (snaApiPid && isProcessRunning(snaApiPid)) {
    console.log(`  SNA API      \u2713  running  (pid=${snaApiPid}, port=${snaApiPort ?? "?"})`);
  } else {
    console.log(`  SNA API      \u2717  stopped`);
    if (snaApiPid) clearSnaApiState();
  }
  if (fs.existsSync(DB_PATH)) {
    const stat = fs.statSync(DB_PATH);
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`  Database     \u2713  ${kb} KB  (${DB_PATH})`);
  } else {
    console.log(`  Database     \u2717  not initialized`);
  }
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
}
function cmdInit(force2 = false) {
  console.log(`\u25B6  SNA \u2014 project init${force2 ? " (--force)" : ""}
`);
  const claudeDir = path.join(ROOT, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  const hookCommand = `node "$CLAUDE_PROJECT_DIR"/node_modules/@sna-sdk/core/dist/scripts/hook.js`;
  const permissionHook = {
    matcher: ".*",
    hooks: [{ type: "command", async: true, command: hookCommand }]
  };
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
    }
  }
  const hooks = settings.hooks ?? {};
  const existing = hooks.PermissionRequest ?? [];
  const alreadySet = existing.some(
    (entry) => entry.hooks?.some((h) => h.command === hookCommand)
  );
  if (!alreadySet) {
    hooks.PermissionRequest = [...existing, permissionHook];
    settings.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    step(".claude/settings.json \u2014 PermissionRequest hook registered");
  } else {
    step(".claude/settings.json \u2014 hook already set, skipped");
  }
  const claudeMdTemplate = path.join(ROOT, "node_modules/@sna-sdk/core/CLAUDE.md.template");
  const claudeMdDest = path.join(claudeDir, "CLAUDE.md");
  if (fs.existsSync(claudeMdTemplate)) {
    if (force2 || !fs.existsSync(claudeMdDest)) {
      fs.copyFileSync(claudeMdTemplate, claudeMdDest);
      step(".claude/CLAUDE.md \u2014 created");
    } else {
      step(".claude/CLAUDE.md \u2014 already exists, skipped");
    }
  }
  const snaCoreSkillsDir = path.join(ROOT, "node_modules/@sna-sdk/core/skills");
  const destSkillsDir = path.join(claudeDir, "skills");
  if (fs.existsSync(snaCoreSkillsDir)) {
    const skillNames = fs.readdirSync(snaCoreSkillsDir);
    for (const skillName of skillNames) {
      const src = path.join(snaCoreSkillsDir, skillName, "SKILL.md");
      if (!fs.existsSync(src)) continue;
      const destDir = path.join(destSkillsDir, skillName);
      const dest = path.join(destDir, "SKILL.md");
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      if (force2 || !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        step(`.claude/skills/${skillName}/SKILL.md \u2014 installed`);
      } else {
        step(`.claude/skills/${skillName}/SKILL.md \u2014 already exists, skipped`);
      }
    }
  }
  console.log("\n\u2713  SNA init complete");
}
function printHelp() {
  console.log(`sna \u2014 Skills-Native Application CLI

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
  sna <task-id> start                  Resume a paused task (retries on error)
  sna <task-id> next [--key val]       Submit scalar data (CLI flags)
  sna <task-id> next <<'EOF' ... EOF   Submit structured data (stdin JSON)
  sna <task-id> cancel                 Cancel a running task
  sna tasks                            List all tasks with status

  Task IDs are 10-digit timestamps (MMDDHHmmss), e.g. 0317143052

Run "sna help workflow" for workflow.yml specification.
Run "sna help submit" for data submission patterns.`);
}
function printWorkflowHelp() {
  console.log(`sna help workflow \u2014 workflow.yml specification

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
        field_name: ".json_key"    # ".key", ".a.b.c", ".[0]", "[.[] | .key]", "."
      event: "Message with {{field_name}}"  # emitted as milestone
      timeout: 60000               # optional, ms (default: 30000)

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
      timeout: 60000               # optional, ms (default: 30000)

      # --- Option 2: scalar values via CLI flags ---
      data:
        - key: count
          when: after
          type: integer            # string | integer | number | boolean | json
          label: "\u4EF6\u6570"
      event: "{{count}} items found"

  complete: "Done: {{field}}"      # interpolated with context
  error: "Failed: {{error}}"       # {{error}} is auto-set on failure

Execution rules:
  - exec steps auto-chain: if multiple exec steps are consecutive,
    CLI runs them all without stopping.
  - instruction steps pause: CLI displays the instruction and waits
    for "sna <id> next" with the required data.
  - Events are emitted to SQLite skill_events automatically.
  - Task state is saved to .sna/tasks/<id>.json after each step.

Error recovery:
  - If a task errors, "sna <id> start" retries from the failed step.
  - The step and task status are reset to in_progress automatically.
  - exec steps are re-executed; instruction steps re-display.

Cancel:
  - "sna <id> cancel" permanently stops a task.
  - Status is set to "cancelled" and an error event is emitted.
  - Cancelled tasks cannot be resumed \u2014 create a new task instead.

Task management:
  - "sna tasks" lists all tasks with ID, skill, status, and current step.
  - Task state files: .sna/tasks/<id>.json`);
}
function printSubmitHelp() {
  console.log(`sna help submit \u2014 data submission patterns

Workflow steps can receive data in two ways:

1. Structured data (stdin JSON) \u2014 for complex/bulk data
   Used when the step has "submit" + "handler" in workflow.yml.

   The model submits JSON via stdin:
     sna <task-id> next <<'EOF'
     [
       {"company_name": "Foo Corp", "url": "https://foo.co", "form_url": "https://foo.co/contact"},
       {"company_name": "Bar Inc", "url": "https://bar.io", "form_url": "https://bar.io/inquiry"}
     ]
     EOF

   Flow:
     stdin JSON \u2192 CLI validates against submit schema
                \u2192 CLI executes handler (e.g. curl to app API)
                \u2192 CLI extracts fields from API response
                \u2192 fields saved to task context
                \u2192 event emitted with interpolated message

   The handler template uses {{submitted}} for the raw JSON string.
   The API response is parsed and fields are extracted via "extract".
   The API is the source of truth \u2014 not the model's self-report.

2. Scalar values (CLI flags) \u2014 for simple key-value pairs
   Used when the step has "data" with "when: after" in workflow.yml.

     sna <task-id> next --registered-count 8 --skipped-count 3

   Flags use --kebab-case, mapped to snake_case context keys.
   Each value is validated against the declared type.

Validation errors:
  - Missing required fields \u2192 error + re-display expected format
  - Wrong types (e.g. "abc" for integer) \u2192 error + expected format
  - Empty stdin when submit is expected \u2192 error + JSON example
  - Invalid JSON \u2192 error + JSON example`);
}
const [, , command, ...args] = process.argv;
const force = args.includes("--force");
const wantsHelp = args.includes("--help") || args.includes("-h");
const isTaskId = /^\d{10}[a-z]?$/.test(command ?? "");
if (command === "help" || command === "--help" || command === "-h" || !command && !isTaskId) {
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
  sna new company-search --query "\u6771\u4EAC\u306ESaaS\u4F01\u696D"

Run "sna help workflow" for workflow.yml specification.`);
  } else {
    cmdNew(args);
  }
} else if (command === "tasks") {
  cmdTasks();
} else if (isTaskId) {
  if (wantsHelp) {
    console.log(`Usage: sna <task-id> <start|next|cancel> [options]

Commands:
  sna <id> start                   Resume task from current step (retries on error)
  sna <id> next --key val          Submit scalar values
  sna <id> next <<'EOF' ... EOF    Submit JSON via stdin
  sna <id> cancel                  Cancel task

Task state: .sna/tasks/<id>.json

Run "sna help submit" for data submission patterns.`);
  } else if (args[0] === "cancel") {
    cmdCancel(command);
  } else {
    cmdWorkflow(command, args);
  }
} else {
  switch (command) {
    case "init":
      cmdInit(force);
      break;
    case "up":
      cmdUp();
      break;
    case "down":
      cmdDown();
      break;
    case "status":
      cmdStatus();
      break;
    case "api:up":
      cmdApiUp();
      break;
    case "api:down":
      cmdApiDown();
      break;
    case "restart":
      cmdDown();
      console.log();
      cmdUp();
      break;
    default:
      printHelp();
  }
}
