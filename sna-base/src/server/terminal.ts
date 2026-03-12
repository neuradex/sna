import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PORT = 3001;
const SHELL = process.env.SHELL || "/bin/zsh";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLAUDE_PATH_FILE = path.join(ROOT, ".lna/claude-path");

// Resolve the real claude binary path (handles aliases and shims)
// Reads from .lna/claude-path cache written by lna up; falls back to live resolution.
function resolveClaudePath(): string {
  // Use cached path from lna up if available
  if (fs.existsSync(CLAUDE_PATH_FILE)) {
    const cached = fs.readFileSync(CLAUDE_PATH_FILE, "utf8").trim();
    if (cached) {
      try {
        execSync(`test -x "${cached}"`, { stdio: "pipe" });
        return cached;
      } catch { /* cached path no longer valid */ }
    }
  }
  // Try common locations
  const candidates = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
  ];
  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return p;
    } catch { /* not found */ }
  }
  // Fall back to resolving via login shell
  try {
    return execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
  } catch {
    return "claude"; // last resort
  }
}

const CLAUDE_PATH = resolveClaudePath();
console.log(`[terminal] claude binary: ${CLAUDE_PATH}`);

// Remove CLAUDECODE env var to avoid nested session detection
const cleanEnv = { ...process.env } as Record<string, string>;
delete cleanEnv.CLAUDECODE;

const wss = new WebSocketServer({ port: PORT });
const connections = new Set<{ ws: WebSocket; ptyProcess: pty.IPty }>();

console.log(`[terminal] WebSocket server on port ${PORT}`);

wss.on("connection", (ws) => {
  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(CLAUDE_PATH, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: cleanEnv,
    });
  } catch (err) {
    console.error("[terminal] Failed to spawn PTY:", err);
    ws.close();
    return;
  }

  const conn = { ws, ptyProcess };
  connections.add(conn);

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[terminal] PTY exited (code=${exitCode})`);
    if (ws.readyState === WebSocket.OPEN) ws.close();
    connections.delete(conn);
  });

  ws.on("message", (data) => {
    const msg = data.toString();
    if (msg.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          ptyProcess.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch { /* pass through */ }
    }
    ptyProcess.write(msg);
  });

  ws.on("close", () => { ptyProcess.kill(); connections.delete(conn); });
  ws.on("error", () => { ptyProcess.kill(); connections.delete(conn); });
});

function shutdown() {
  for (const { ws, ptyProcess } of connections) {
    ptyProcess.kill();
    ws.close();
  }
  wss.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
