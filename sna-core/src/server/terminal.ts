import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const PORT = 3001;
const SHELL = process.env.SHELL || "/bin/zsh";

const ROOT = process.cwd();
const CLAUDE_PATH_FILE = path.join(ROOT, ".sna/claude-path");

function resolveClaudePath(): string {
  if (fs.existsSync(CLAUDE_PATH_FILE)) {
    const cached = fs.readFileSync(CLAUDE_PATH_FILE, "utf8").trim();
    if (cached) {
      try {
        execSync(`test -x "${cached}"`, { stdio: "pipe" });
        return cached;
      } catch { /* cached path no longer valid */ }
    }
  }
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
  try {
    return execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
  } catch {
    return "claude";
  }
}

const CLAUDE_PATH = resolveClaudePath();
console.log(`[terminal] claude binary: ${CLAUDE_PATH}`);

// Remove CLAUDECODE env var to avoid nested session detection
const cleanEnv = { ...process.env } as Record<string, string>;
delete cleanEnv.CLAUDECODE;

const wss = new WebSocketServer({ port: PORT });
const activePtys = new Set<pty.IPty>();

console.log(`[terminal] WebSocket server on port ${PORT}`);

wss.on("connection", (ws) => {
  let ptyProcess: pty.IPty | null = null;

  function spawnPty(claudeArgs: string[]) {
    try {
      ptyProcess = pty.spawn(CLAUDE_PATH, claudeArgs, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: ROOT,
        env: cleanEnv,
      });
    } catch (err) {
      console.error("[terminal] Failed to spawn PTY:", err);
      ws.close();
      return;
    }

    activePtys.add(ptyProcess);

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[terminal] PTY exited (code=${exitCode})`);
      if (ptyProcess) activePtys.delete(ptyProcess);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  }

  // If the client doesn't send an init message within 500ms, spawn with defaults
  const initTimeout = setTimeout(() => {
    if (!ptyProcess) spawnPty([]);
  }, 500);

  ws.on("message", (data) => {
    const msg = data.toString();
    if (msg.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg);

        if (parsed.type === "init") {
          clearTimeout(initTimeout);
          if (!ptyProcess) {
            const args: string[] = [];
            if (parsed.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
            spawnPty(args);
          }
          return;
        }

        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          if (ptyProcess) ptyProcess.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch { /* pass through as raw input */ }
    }
    if (ptyProcess) ptyProcess.write(msg);
  });

  ws.on("close", () => {
    clearTimeout(initTimeout);
    if (ptyProcess) { activePtys.delete(ptyProcess); ptyProcess.kill(); }
  });

  ws.on("error", () => {
    clearTimeout(initTimeout);
    if (ptyProcess) { activePtys.delete(ptyProcess); ptyProcess.kill(); }
  });
});

function shutdown() {
  for (const p of activePtys) p.kill();
  wss.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
