/**
 * sna.ts — Skills-Native Application lifecycle manager
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
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const STATE_DIR = path.join(ROOT, ".sna");
const PID_FILE = path.join(STATE_DIR, "next.pid");
const PORT_FILE = path.join(STATE_DIR, "port");
const LOG_FILE = path.join(STATE_DIR, "next.log");

const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const PORT = process.env.PORT ?? "3000";
const WS_PORT = "3001";
const DB_PATH = path.join(ROOT, "data/devlog.db");
const WS_PID_FILE = path.join(STATE_DIR, "terminal.pid");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");

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

function step(label: string, done = true) {
  const status = done ? "✓" : "…";
  console.log(`  ${status}  ${label}`);
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
    console.log(`→  http://localhost:${port}/devlog`);
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
      execSync("pnpm install --frozen-lockfile", {
        cwd: ROOT,
        stdio: "pipe",
      });
      console.log("\r  ✓  Dependencies installed          ");
    } catch {
      // frozen-lockfile might fail if lockfile is out of sync; fallback
      execSync("pnpm install", { cwd: ROOT, stdio: "pipe" });
      console.log("\r  ✓  Dependencies installed          ");
    }
  } else {
    step("Dependencies ready");
  }

  // 4. Init DB if needed
  if (!fs.existsSync(DB_PATH)) {
    process.stdout.write("  …  Setting up database");
    execSync("pnpm db:init", { cwd: ROOT, stdio: "pipe" });
    console.log("\r  ✓  Database initialized (seed data loaded)");
  } else {
    step("Database ready");
  }

  // 5. Kill anything already on the port
  if (isPortInUse(PORT)) {
    process.stdout.write(`  …  Port ${PORT} busy — freeing`);
    try {
      execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: "pipe" });
    } catch { /* ignore */ }
    console.log(`\r  ✓  Port ${PORT} cleared              `);
  }

  // 6. Ensure node-pty spawn-helper is executable (prebuild permission fix)
  const spawnHelper = path.join(ROOT, "node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
  if (fs.existsSync(spawnHelper)) {
    const mode = fs.statSync(spawnHelper).mode;
    const isExecutable = (mode & 0o111) !== 0;
    if (!isExecutable) {
      fs.chmodSync(spawnHelper, 0o755);
      step("node-pty spawn-helper permissions fixed");
    }
  }

  // 6. Kill WS port if busy
  if (isPortInUse(WS_PORT)) {
    try { execSync(`lsof -ti:${WS_PORT} | xargs kill -9`, { stdio: "pipe" }); } catch { /* ignore */ }
  }

  // 7. Resolve + cache claude binary path
  ensureStateDir();
  const claudePath = resolveAndCacheClaudePath();
  step(`Claude binary: ${claudePath}`);

  // 8. Spawn terminal WebSocket server (detached)
  ensureStateDir();
  const wsLog = fs.openSync(path.join(STATE_DIR, "terminal.log"), "w");
  const wsChild = spawn(TSX, ["src/server/terminal.ts"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", wsLog, wsLog],
  });
  wsChild.unref();
  fs.writeFileSync(WS_PID_FILE, String(wsChild.pid!));
  step("Terminal WebSocket server starting");

  // 8. Spawn Next.js dev server (detached)
  const logStream = fs.openSync(LOG_FILE, "w");
  const child = spawn("pnpm", ["dev", "--port", PORT], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    env: { ...process.env, PORT },
  });
  child.unref();
  writePid(child.pid!);

  // 7. Wait for server ready
  process.stdout.write("  …  Starting web server");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    execSync("sleep 1");
    if (isPortInUse(PORT)) { ready = true; break; }
    process.stdout.write(".");
  }
  console.log(ready
    ? "\r  ✓  Web server running                    "
    : "\r  △  Web server starting (check .sna/next.log)");

  // 8. Open browser
  const url = `http://localhost:${PORT}`;
  openBrowser(url);

  console.log(`
✓  SNA is up

   Landing page  →  ${url}
   Dev dashboard →  ${url}/devlog

   Skills ready:
     /sna-down        stop everything
     /devlog-collect  scan your git repos
     /devlog-analyze  analyze coding patterns
     /devlog-report   generate weekly report

   Logs: .sna/next.log`);
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
    // Kill the process group to catch child processes too
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch { /* already gone */ }
  }

  // Wait for port to free
  let freed = false;
  for (let i = 0; i < 10; i++) {
    execSync("sleep 0.5");
    if (!isPortInUse(PORT)) { freed = true; break; }
  }

  // Also stop terminal WS server
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

// ── router ────────────────────────────────────────────────────────────────────

const [, , command] = process.argv;

switch (command) {
  case "up":      cmdUp();     break;
  case "down":    cmdDown();   break;
  case "status":  cmdStatus(); break;
  case "restart":
    cmdDown();
    console.log();
    cmdUp();
    break;
  default:
    console.log(`sna <up|down|status|restart>`);
}
