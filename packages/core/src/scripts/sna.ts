/**
 * sna.ts — LLM-Native Application lifecycle manager
 *
 * Core primitive for every SNA project.
 * Manages the full environment: DB init, web server, background processes.
 *
 * Commands:
 *   sna up       — start all services
 *   sna down     — stop all services
 *   sna status   — show running services
 *   sna restart  — down + up
 *   sna validate — check project setup
 *   sna dispatch — unified event dispatcher
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { cmdNew, cmdWorkflow, cmdCancel, cmdTasks } from "./workflow.js";
import { parseFlags } from "../lib/parse-flags.js";
import { loadSkillsManifest, SEND_TYPES, type DispatchEventType } from "../lib/dispatch.js";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".sna");
const PID_FILE = path.join(STATE_DIR, "server.pid");
const PORT_FILE = path.join(STATE_DIR, "port");
const LOG_FILE = path.join(STATE_DIR, "server.log");
const SNA_API_PID_FILE = path.join(STATE_DIR, "sna-api.pid");
const SNA_API_PORT_FILE = path.join(STATE_DIR, "sna-api.port");
const SNA_API_LOG_FILE = path.join(STATE_DIR, "sna-api.log");

const PORT = process.env.PORT ?? "3000";
const CLAUDE_PATH_FILE = path.join(STATE_DIR, "claude-path");

const SNA_CORE_DIR = path.join(ROOT, "node_modules/@sna-sdk/core");
const NATIVE_DIR = path.join(STATE_DIR, "native");
const MOCK_API_PID_FILE = path.join(STATE_DIR, "mock-api.pid");
const MOCK_API_PORT_FILE = path.join(STATE_DIR, "mock-api.port");
const MOCK_API_LOG_FILE = path.join(STATE_DIR, "mock-api.log");

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

function readSnaApiPid(): number | null {
  if (!fs.existsSync(SNA_API_PID_FILE)) return null;
  const raw = fs.readFileSync(SNA_API_PID_FILE, "utf8").trim();
  const pid = parseInt(raw);
  return isNaN(pid) ? null : pid;
}

function readSnaApiPort(): string | null {
  if (!fs.existsSync(SNA_API_PORT_FILE)) return null;
  return fs.readFileSync(SNA_API_PORT_FILE, "utf8").trim() || null;
}

function clearSnaApiState() {
  for (const f of [SNA_API_PID_FILE, SNA_API_PORT_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function findFreePort(): string {
  const srv = net.createServer();
  srv.listen(0);
  const addr = srv.address();
  const port = String((addr as net.AddressInfo).port);
  srv.close();
  return port;
}

async function checkSnaApiHealth(port: string): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const json = await res.json() as { name?: string };
    return json.name === "sna";
  } catch {
    return false;
  }
}

/**
 * api:up — ensure the SNA internal API server is running.
 *
 * Called by consumer startup scripts. Handles:
 *   - Already running (SNA)  → reuse silently
 *   - Port occupied (non-SNA) → error + exit 1
 *   - Not running             → spawn standalone.js as background daemon
 */
/**
 * Ensure better-sqlite3 is installed in .sna/native/ for system Node.js.
 * This isolates the native binary from the host app's node_modules,
 * preventing electron-rebuild from clobbering it.
 */
function ensureNativeDeps() {
  const marker = path.join(NATIVE_DIR, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");

  // Already installed — verify it loads with current Node.js
  if (fs.existsSync(marker)) {
    try {
      const { createRequire } = require("module");
      const req = createRequire(path.join(NATIVE_DIR, "noop.js"));
      const BS3 = req("better-sqlite3");
      new BS3(":memory:").close();
      return; // Works
    } catch (err: any) {
      if (!err.message?.includes("NODE_MODULE_VERSION")) return; // non-version error, keep going
      // Version mismatch — reinstall below
      step("Native binary version mismatch — reinstalling...");
    }
  }

  // Resolve the version from SDK's own package.json
  let version: string;
  try {
    const pkgPath = require.resolve("better-sqlite3/package.json", { paths: [SNA_CORE_DIR, ROOT] });
    version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  } catch {
    version = "^12.0.0"; // safe fallback
  }

  step(`Installing isolated better-sqlite3@${version} in .sna/native/`);
  fs.mkdirSync(NATIVE_DIR, { recursive: true });
  fs.writeFileSync(path.join(NATIVE_DIR, "package.json"), JSON.stringify({
    name: "sna-native-deps",
    private: true,
    dependencies: { "better-sqlite3": version },
  }));

  try {
    execSync("npm install --no-package-lock --ignore-scripts", { cwd: NATIVE_DIR, stdio: "pipe" });
    // Download prebuilt binary for current Node.js
    execSync("npx --yes prebuild-install -r napi", {
      cwd: path.join(NATIVE_DIR, "node_modules", "better-sqlite3"),
      stdio: "pipe",
    });
    step("Native deps ready");
  } catch (err: any) {
    // prebuild-install may fail — try node-gyp rebuild as fallback
    try {
      execSync("npm rebuild better-sqlite3", { cwd: NATIVE_DIR, stdio: "pipe" });
      step("Native deps ready (compiled from source)");
    } catch {
      console.error(`\n✗  Failed to install isolated better-sqlite3: ${err.message}`);
      console.error(`   Try manually: cd .sna/native && npm install\n`);
      process.exit(1);
    }
  }
}

async function cmdApiUp() {
  const standaloneEntry = path.join(SNA_CORE_DIR, "dist/server/standalone.js");

  // 0. Ensure native dependencies are available for system Node.js
  ensureNativeDeps();

  // 1. Check if we already have a running instance for this project
  const existingPort = process.env.SNA_PORT ?? readSnaApiPort();
  if (existingPort && isPortInUse(existingPort)) {
    const healthy = await checkSnaApiHealth(existingPort);
    if (healthy) {
      step(`SNA API already running on :${existingPort} — reusing`);
      return;
    }
  }

  if (!fs.existsSync(standaloneEntry)) {
    console.error(`\n✗  SNA standalone server not found: ${standaloneEntry}`);
    console.error(`   Run "pnpm build" in sna-core.\n`);
    process.exit(1);
  }

  // 2. Kill stale process if any
  const staleApiPid = readSnaApiPid();
  if (staleApiPid && isProcessRunning(staleApiPid)) {
    try { process.kill(staleApiPid, "SIGTERM"); } catch { /* ignore */ }
  }

  // 3. Allocate port: explicit env > saved port (if free) > random free port
  const port = process.env.SNA_PORT ?? (existingPort && !isPortInUse(existingPort) ? existingPort : findFreePort());

  ensureStateDir();
  const logStream = fs.openSync(SNA_API_LOG_FILE, "w");
  const child = spawn("node", [standaloneEntry], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logStream, logStream],
    env: { ...process.env, SNA_PORT: port },
  });
  child.unref();
  fs.writeFileSync(SNA_API_PID_FILE, String(child.pid!));
  fs.writeFileSync(SNA_API_PORT_FILE, port);
  step(`SNA API server → http://localhost:${port}`);
}

function cmdApiDown() {
  const pid = readSnaApiPid();
  const port = readSnaApiPort();
  if (pid && isProcessRunning(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
    for (let i = 0; i < 6; i++) {
      if (!isProcessRunning(pid)) break;
      execSync("sleep 0.5", { stdio: "pipe" });
    }
    if (isProcessRunning(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
    }
    console.log(`   SNA API     ✓  stopped (pid=${pid})`);
  } else {
    console.log(`   SNA API     —  not running`);
  }
  // Clean up port in case of orphans
  if (port) {
    try { execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: "pipe" }); } catch { /* ok */ }
  }
  clearSnaApiState();
}

// ── Test Utilities (sna tu) ─────────────────────────────────────────────────

function cmdTu(args: string[]) {
  const sub = args[0];
  switch (sub) {
    case "api:up":   cmdTuApiUp(); break;
    case "api:down": cmdTuApiDown(); break;
    case "api:log":  cmdTuApiLog(args.slice(1)); break;
    case "claude":   cmdTuClaude(args.slice(1)); break;
    default:
      console.log(`
  sna tu — Test utilities (mock Anthropic API)

  Commands:
    sna tu api:up       Start mock Anthropic API server
    sna tu api:down     Stop mock API server
    sna tu api:log      Show mock API request/response log
    sna tu api:log -f   Follow log in real-time (tail -f)
    sna tu claude ...   Run claude with mock API env vars (proxy)

  Flow:
    1. sna tu api:up            → mock server on random port
    2. sna tu claude "say hi"   → real claude → mock API → mock response
    3. sna tu api:log -f        → watch requests/responses in real-time
    4. sna tu api:down          → cleanup

  All requests/responses are logged to .sna/mock-api.log
`);
  }
}

function cmdTuApiUp() {
  ensureStateDir();

  // Check if already running
  const existingPid = readPidFile(MOCK_API_PID_FILE);
  const existingPort = readPortFile(MOCK_API_PORT_FILE);
  if (existingPid && isProcessRunning(existingPid)) {
    step(`Mock API already running on :${existingPort} (pid=${existingPid})`);
    return;
  }

  // Resolve mock-api entry point (works for both dist/ and src/)
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const mockEntry = path.join(scriptDir, "../testing/mock-api.js");
  const mockEntrySrc = path.join(scriptDir, "../testing/mock-api.ts");
  const resolvedMockEntry = fs.existsSync(mockEntry) ? mockEntry : mockEntrySrc;
  if (!fs.existsSync(resolvedMockEntry)) {
    console.error("✗  Mock API server not found. Run pnpm build first.");
    process.exit(1);
  }

  const logStream = fs.openSync(MOCK_API_LOG_FILE, "w");
  // Use a startup script that logs port to file
  const startScript = `
    import { startMockAnthropicServer } from "${resolvedMockEntry.replace(/\\/g, "/")}";
    const mock = await startMockAnthropicServer();
    const fs = await import("fs");
    fs.writeFileSync("${MOCK_API_PORT_FILE.replace(/\\/g, "/")}", String(mock.port));
    console.log("Mock Anthropic API ready on :" + mock.port);
    // Keep alive
    process.on("SIGTERM", () => { mock.close(); process.exit(0); });
  `;

  const child = spawn("node", ["--import", "tsx", "-e", startScript], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logStream, logStream],
  });
  child.unref();
  fs.writeFileSync(MOCK_API_PID_FILE, String(child.pid!));

  // Wait for port file
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(MOCK_API_PORT_FILE) && fs.readFileSync(MOCK_API_PORT_FILE, "utf8").trim()) break;
    execSync("sleep 0.3", { stdio: "pipe" });
  }

  const port = readPortFile(MOCK_API_PORT_FILE);
  if (port) {
    step(`Mock Anthropic API → http://localhost:${port} (log: .sna/mock-api.log)`);
  } else {
    console.error("✗  Mock API failed to start. Check .sna/mock-api.log");
  }
}

function cmdTuApiDown() {
  const pid = readPidFile(MOCK_API_PID_FILE);
  if (pid && isProcessRunning(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    console.log(`   Mock API    ✓  stopped (pid=${pid})`);
  } else {
    console.log(`   Mock API    —  not running`);
  }
  try { fs.unlinkSync(MOCK_API_PID_FILE); } catch {}
  try { fs.unlinkSync(MOCK_API_PORT_FILE); } catch {}
}

function cmdTuApiLog(args: string[]) {
  if (!fs.existsSync(MOCK_API_LOG_FILE)) {
    console.log("No log file. Start mock API with: sna tu api:up");
    return;
  }
  const follow = args.includes("-f") || args.includes("--follow");
  if (follow) {
    execSync(`tail -f "${MOCK_API_LOG_FILE}"`, { stdio: "inherit" });
  } else {
    execSync(`cat "${MOCK_API_LOG_FILE}"`, { stdio: "inherit" });
  }
}

function cmdTuClaude(args: string[]) {
  const port = readPortFile(MOCK_API_PORT_FILE);
  if (!port) {
    console.error("✗  Mock API not running. Start with: sna tu api:up");
    process.exit(1);
  }

  const claudePath = resolveAndCacheClaudePath();
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://localhost:${port}`,
    ANTHROPIC_API_KEY: "sk-test-mock-sna",
  };

  // Forward all args to real claude
  try {
    execSync(`"${claudePath}" ${args.map(a => `"${a}"`).join(" ")}`, {
      stdio: "inherit",
      env,
      cwd: ROOT,
    });
  } catch (e: any) {
    process.exit(e.status ?? 1);
  }
}

function readPidFile(filePath: string): number | null {
  try { return parseInt(fs.readFileSync(filePath, "utf8").trim(), 10) || null; } catch { return null; }
}

function readPortFile(filePath: string): string | null {
  try { return fs.readFileSync(filePath, "utf8").trim() || null; } catch { return null; }
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

  // SDK's sna.db auto-initializes on first getDb() call — no explicit init needed
  // App's DB is the app's responsibility (e.g., app's own db:init script)

  // 5. Kill anything already on the web port
  if (isPortInUse(PORT)) {
    process.stdout.write(`  …  Port ${PORT} busy — freeing`);
    try { execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: "pipe" }); } catch { /* ignore */ }
    console.log(`\r  ✓  Port ${PORT} cleared              `);
  }

  // 6. Resolve + cache claude binary path
  ensureStateDir();
  const claudePath = resolveAndCacheClaudePath();
  step(`Claude binary: ${claudePath}`);

  // 7. Spawn SNA internal API server
  const standaloneEntry = path.join(SNA_CORE_DIR, "dist/server/standalone.js");
  if (fs.existsSync(standaloneEntry)) {
    // Kill any stale SNA API process
    const staleApiPid = readSnaApiPid();
    const staleApiPort = readSnaApiPort();
    if (staleApiPid && isProcessRunning(staleApiPid)) {
      try { process.kill(staleApiPid, "SIGTERM"); } catch { /* ignore */ }
    }
    if (staleApiPort && isPortInUse(staleApiPort)) {
      try { execSync(`lsof -ti:${staleApiPort} | xargs kill -9`, { stdio: "pipe" }); } catch { /* ignore */ }
    }

    const snaApiPort = process.env.SNA_PORT ?? findFreePort();
    const snaApiLogStream = fs.openSync(SNA_API_LOG_FILE, "w");
    const snaApiChild = spawn("node", [standaloneEntry], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", snaApiLogStream, snaApiLogStream],
      env: { ...process.env, SNA_PORT: snaApiPort },
    });
    snaApiChild.unref();
    ensureStateDir();
    fs.writeFileSync(SNA_API_PID_FILE, String(snaApiChild.pid!));
    fs.writeFileSync(SNA_API_PORT_FILE, snaApiPort);
    step(`SNA API server → http://localhost:${snaApiPort}`);
  }

  // 8. Spawn dev server (app defines its own `pnpm dev`)
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

  clearState();
  console.log(`   Web server  ✓  (pid=${pid} stopped)`);
  if (!freed) console.log(`   Note: port ${PORT} may still be in use briefly`);

  // Stop SNA API server
  const snaApiPid = readSnaApiPid();
  if (snaApiPid && isProcessRunning(snaApiPid)) {
    try { process.kill(snaApiPid, "SIGTERM"); } catch { /* ignore */ }
    console.log(`   SNA API     ✓  (pid=${snaApiPid} stopped)`);
  }
  clearSnaApiState();

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

  const snaApiPid = readSnaApiPid();
  const snaApiPort = readSnaApiPort();
  if (snaApiPid && isProcessRunning(snaApiPid)) {
    console.log(`  SNA API      ✓  running  (pid=${snaApiPid}, port=${snaApiPort ?? "?"})`);
  } else {
    console.log(`  SNA API      ✗  stopped`);
    if (snaApiPid) clearSnaApiState();
  }

  const snaDbPath = path.join(ROOT, "data/sna.db");
  if (fs.existsSync(snaDbPath)) {
    const stat = fs.statSync(snaDbPath);
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`  SDK DB       ✓  ${kb} KB  (${snaDbPath})`);
  } else {
    console.log(`  SDK DB       —  not yet created (auto-initializes on first use)`);
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

  const hookCommand = `node "$CLAUDE_PROJECT_DIR"/node_modules/@sna-sdk/core/dist/scripts/hook.js`;

  const permissionHook = {
    matcher: ".*",
    hooks: [{ type: "command", command: hookCommand }],
  };

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch { /* start fresh if malformed */ }
  }

  // Merge PreToolUse hook — avoid duplicates
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const existing = (hooks.PreToolUse ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
  const alreadySet = existing.some((entry) =>
    entry.hooks?.some((h) => h.command === hookCommand)
  );

  if (!alreadySet) {
    hooks.PreToolUse = [...existing, permissionHook];
    settings.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    step(".claude/settings.json — PreToolUse hook registered");
  } else {
    step(".claude/settings.json — hook already set, skipped");
  }

  // Copy CLAUDE.md template → .claude/CLAUDE.md
  const claudeMdTemplate = path.join(ROOT, "node_modules/@sna-sdk/core/CLAUDE.md.template");
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

// ── validate ─────────────────────────────────────────────────────────────────

function cmdValidate() {
  console.log("▶  SNA — validate\n");

  let ok = true;

  // 1. .sna/skills.json exists
  const manifest = loadSkillsManifest(ROOT);
  if (!manifest) {
    console.log("  ✗  .sna/skills.json not found or malformed — run 'sna gen client' first");
    ok = false;
  } else {
    const skillNames = Object.keys(manifest);
    console.log(`  ✓  .sna/skills.json — ${skillNames.length} skills registered`);

    // 2. Each registered skill has a SKILL.md
    for (const name of skillNames) {
      const skillMd = path.join(ROOT, ".claude/skills", name, "SKILL.md");
      if (!fs.existsSync(skillMd)) {
        console.log(`  ✗  skill "${name}" registered but .claude/skills/${name}/SKILL.md missing`);
        ok = false;
      }
    }

    // 3. Check for unregistered skills (SKILL.md exists but not in manifest)
    const skillsDir = path.join(ROOT, ".claude/skills");
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir)) {
        const skillMd = path.join(skillsDir, entry, "SKILL.md");
        if (fs.existsSync(skillMd) && !(entry in manifest)) {
          console.log(`  △  skill "${entry}" has SKILL.md but not in skills.json — run 'sna gen client'`);
        }
      }
    }
  }

  // 4. .claude/settings.json hook
  const settingsPath = path.join(ROOT, ".claude/settings.json");
  if (!fs.existsSync(settingsPath)) {
    console.log("  ✗  .claude/settings.json not found — run 'sna init'");
    ok = false;
  } else {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const hooks = settings.hooks?.PreToolUse;
      const hookCommand = `node "$CLAUDE_PROJECT_DIR"/node_modules/@sna-sdk/core/dist/scripts/hook.js`;
      const hasHook = Array.isArray(hooks) && hooks.some(
        (entry: { hooks?: Array<{ command?: string }> }) =>
          entry.hooks?.some((h) => h.command === hookCommand)
      );
      if (hasHook) {
        console.log("  ✓  .claude/settings.json — PreToolUse hook OK");
      } else {
        console.log("  ✗  .claude/settings.json — PreToolUse hook missing — run 'sna init'");
        ok = false;
      }
    } catch {
      console.log("  ✗  .claude/settings.json is malformed");
      ok = false;
    }
  }

  // 5. node_modules
  const nmPath = path.join(ROOT, "node_modules");
  if (!fs.existsSync(nmPath)) {
    console.log("  ✗  node_modules not found — run 'pnpm install'");
    ok = false;
  } else {
    console.log("  ✓  node_modules — installed");
  }

  console.log(ok ? "\n✓  Validation passed" : "\n✗  Validation failed — fix issues above");
  if (!ok) process.exit(1);
}

// ── dispatch ─────────────────────────────────────────────────────────────────

async function cmdDispatch(args: string[]) {
  const { open, send, close } = await import("../lib/dispatch.js");

  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`sna dispatch — unified event dispatcher

Usage:
  sna dispatch open --skill <name>              Open a dispatch session → prints ID
  sna dispatch <id> called --message "..."      Emit called event
  sna dispatch <id> start --message "..."       Emit start event
  sna dispatch <id> milestone --message "..."   Emit milestone event
  sna dispatch <id> progress --message "..."    Emit progress event
  sna dispatch <id> close [--message "..."]     Close as success (complete + kill)
  sna dispatch <id> close --error "..."         Close as error (error + kill)`);
    return;
  }

  if (sub === "open") {
    const flags = parseFlags(args.slice(1));
    if (!flags.skill) {
      console.error("Usage: sna dispatch open --skill <name>");
      process.exit(1);
    }
    try {
      const result = open({ skill: flags.skill, cwd: ROOT });
      // Print only the ID to stdout so it can be captured: ID=$(sna dispatch open ...)
      console.log(result.id);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // All other subcommands: sna dispatch <id> <action> [flags]
  const id = sub;
  const action = args[1];

  if (!action) {
    console.error("Usage: sna dispatch <id> <called|start|milestone|progress|close>");
    process.exit(1);
  }

  const flags = parseFlags(args.slice(2));

  try {
    if (action === "close") {
      await close(id, {
        error: flags.error,
        message: flags.message,
      });
    } else if (SEND_TYPES.includes(action)) {
      if (!flags.message) {
        console.error(`Usage: sna dispatch <id> ${action} --message "..."`);
        process.exit(1);
      }
      send(id, { type: action as DispatchEventType, message: flags.message, data: flags.data });
    } else {
      console.error(`Unknown dispatch action: "${action}". Use ${SEND_TYPES.join(", ")}, or close.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
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
  sna validate        Check project setup (skills.json, hooks, deps)
  sna dispatch        Unified event dispatcher (open/send/close)

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
  - Task state is saved to .sna/tasks/<id>.json after each step.

Error recovery:
  - If a task errors, "sna <id> start" retries from the failed step.
  - The step and task status are reset to in_progress automatically.
  - exec steps are re-executed; instruction steps re-display.

Cancel:
  - "sna <id> cancel" permanently stops a task.
  - Status is set to "cancelled" and an error event is emitted.
  - Cancelled tasks cannot be resumed — create a new task instead.

Task management:
  - "sna tasks" lists all tasks with ID, skill, status, and current step.
  - Task state files: .sna/tasks/<id>.json`);
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
    cmdCancel(command!);
  } else {
    cmdWorkflow(command!, args);
  }
} else {
  switch (command) {
    case "init":     cmdInit(force); break;
    case "up":       cmdUp();        break;
    case "down":     cmdDown();      break;
    case "status":   cmdStatus();    break;
    case "validate": cmdValidate();       break;
    case "dispatch": cmdDispatch(args);  break;
    case "api:up":      cmdApiUp();      break;
    case "api:down":    cmdApiDown();    break;
    case "api:restart": cmdApiDown(); cmdApiUp(); break;
    case "tu":          cmdTu(args);    break;
    case "restart":
      cmdDown();
      console.log();
      cmdUp();
      break;
    case "gen":
      if (args[0] === "client") {
        // Delegate to gen-client script
        const { execSync: exec } = require("child_process");
        const genScript = path.join(__dirname, "gen-client.js");
        exec(`node "${genScript}" ${args.slice(1).join(" ")}`, { stdio: "inherit", cwd: ROOT });
      } else {
        console.log("Usage: sna gen client [--out <path>] [--skills-dir <path>]");
      }
      break;
    default:
      printHelp();
  }
}
