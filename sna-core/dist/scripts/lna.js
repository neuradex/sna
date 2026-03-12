import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".sna");
const PID_FILE = path.join(STATE_DIR, "next.pid");
const PORT_FILE = path.join(STATE_DIR, "port");
const LOG_FILE = path.join(STATE_DIR, "next.log");
const PORT = process.env.PORT ?? "3000";
const WS_PORT = "3001";
const DB_PATH = path.join(ROOT, "data/app.db");
const WS_PID_FILE = path.join(STATE_DIR, "terminal.pid");
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");
const LNA_CORE_DIR = path.join(ROOT, "node_modules/lna");
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
  const spawnHelper = path.join(ROOT, "node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
  if (fs.existsSync(spawnHelper)) {
    const mode = fs.statSync(spawnHelper).mode;
    if ((mode & 73) === 0) {
      fs.chmodSync(spawnHelper, 493);
      step("node-pty spawn-helper permissions fixed");
    }
  }
  if (isPortInUse(WS_PORT)) {
    try {
      execSync(`lsof -ti:${WS_PORT} | xargs kill -9`, { stdio: "pipe" });
    } catch {
    }
  }
  ensureStateDir();
  const claudePath = resolveAndCacheClaudePath();
  step(`Claude binary: ${claudePath}`);
  const wsLog = fs.openSync(path.join(STATE_DIR, "terminal.log"), "w");
  const wsChild = spawn("node", [path.join(LNA_CORE_DIR, "dist/server/terminal.js")], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", wsLog, wsLog]
  });
  wsChild.unref();
  fs.writeFileSync(WS_PID_FILE, String(wsChild.pid));
  step("Terminal WebSocket server starting");
  const logStream = fs.openSync(LOG_FILE, "w");
  const child = spawn("pnpm", ["dev", "--port", PORT], {
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
  console.log(ready ? "\r  \u2713  Web server running                    " : "\r  \u25B3  Web server starting (check .sna/next.log)");
  const url = `http://localhost:${PORT}`;
  openBrowser(url);
  console.log(`
\u2713  SNA is up

   App  \u2192  ${url}

   Logs: .sna/next.log`);
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
  if (fs.existsSync(WS_PID_FILE)) {
    const wsPid = parseInt(fs.readFileSync(WS_PID_FILE, "utf8").trim());
    if (!isNaN(wsPid) && isProcessRunning(wsPid)) {
      try {
        process.kill(-wsPid, "SIGTERM");
      } catch {
        try {
          process.kill(wsPid, "SIGKILL");
        } catch {
        }
      }
    }
    fs.unlinkSync(WS_PID_FILE);
    console.log(`   Terminal WS \u2713  (pid=${wsPid} stopped)`);
  }
  clearState();
  console.log(`   Web server  \u2713  (pid=${pid} stopped)`);
  if (!freed) console.log(`   Note: port ${PORT} may still be in use briefly`);
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
  if (fs.existsSync(DB_PATH)) {
    const stat = fs.statSync(DB_PATH);
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`  Database     \u2713  ${kb} KB  (${DB_PATH})`);
  } else {
    console.log(`  Database     \u2717  not initialized`);
  }
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
}
const [, , command] = process.argv;
switch (command) {
  case "up":
    cmdUp();
    break;
  case "down":
    cmdDown();
    break;
  case "status":
    cmdStatus();
    break;
  case "restart":
    cmdDown();
    console.log();
    cmdUp();
    break;
  default:
    console.log(`lna <up|down|status|restart>`);
}
