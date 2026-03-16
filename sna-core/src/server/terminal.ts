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

// Remove Claude Code env vars to avoid nested session detection
const cleanEnv = { ...process.env } as Record<string, string>;
delete cleanEnv.CLAUDECODE;
delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;

const wss = new WebSocketServer({ port: PORT });
const activePtys = new Set<pty.IPty>();

console.log(`[terminal] WebSocket server on port ${PORT}`);

wss.on("connection", (ws, req) => {
  // Read config from URL query params — avoids any message-stream timing issues
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const claudeArgs: string[] = ["--continue"];
  if (url.searchParams.get("dangerouslySkipPermissions") === "1") {
    claudeArgs.push("--dangerously-skip-permissions");
  }

  let ptyProcess: pty.IPty | null = null;

  // Spawn (or re-spawn) a PTY on the same WS connection.
  // Called on first connect AND on in-band {type:"restart"} messages.
  function spawnPty() {
    // Kill the previous PTY if still alive
    if (ptyProcess) {
      activePtys.delete(ptyProcess);
      try { ptyProcess.kill(); } catch { /* already dead */ }
      ptyProcess = null;
    }

    let proc: pty.IPty;
    try {
      proc = pty.spawn(CLAUDE_PATH, claudeArgs, {
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

    ptyProcess = proc;
    activePtys.add(proc);

    proc.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    proc.onExit(({ exitCode }) => {
      console.log(`[terminal] PTY exited (code=${exitCode})`);
      activePtys.delete(proc);
      if (ptyProcess === proc) ptyProcess = null;
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  }

  // Initial spawn
  spawnPty();

  ws.on("message", (data) => {
    const msg = data.toString();
    if (msg.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg);

        // In-band restart: kill current PTY and spawn a new one (WS stays open)
        if (parsed.type === "restart") {
          console.log("[terminal] In-band restart requested");
          spawnPty();
          return;
        }

        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          ptyProcess?.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch { /* pass through as raw input */ }
    }
    ptyProcess?.write(msg);
  });

  ws.on("close", () => {
    if (ptyProcess) { activePtys.delete(ptyProcess); ptyProcess.kill(); ptyProcess = null; }
  });
  ws.on("error", () => {
    if (ptyProcess) { activePtys.delete(ptyProcess); ptyProcess.kill(); ptyProcess = null; }
  });
});

function shutdown() {
  for (const p of activePtys) p.kill();
  wss.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
