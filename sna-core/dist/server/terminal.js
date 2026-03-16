import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
const PORT = 3001;
const SHELL = process.env.SHELL || "/bin/zsh";
const ROOT = process.cwd();
const CLAUDE_PATH_FILE = path.join(ROOT, ".sna/claude-path");
function resolveClaudePath() {
  if (fs.existsSync(CLAUDE_PATH_FILE)) {
    const cached = fs.readFileSync(CLAUDE_PATH_FILE, "utf8").trim();
    if (cached) {
      try {
        execSync(`test -x "${cached}"`, { stdio: "pipe" });
        return cached;
      } catch {
      }
    }
  }
  const candidates = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`
  ];
  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return p;
    } catch {
    }
  }
  try {
    return execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
  } catch {
    return "claude";
  }
}
const CLAUDE_PATH = resolveClaudePath();
console.log(`[terminal] claude binary: ${CLAUDE_PATH}`);
const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDECODE;
delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
const wss = new WebSocketServer({ port: PORT });
const activePtys = /* @__PURE__ */ new Set();
console.log(`[terminal] WebSocket server on port ${PORT}`);
wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const claudeArgs = ["--continue"];
  if (url.searchParams.get("dangerouslySkipPermissions") === "1") {
    claudeArgs.push("--dangerously-skip-permissions");
  }
  let ptyProcess = null;
  function spawnPty() {
    if (ptyProcess) {
      activePtys.delete(ptyProcess);
      try {
        ptyProcess.kill();
      } catch {
      }
      ptyProcess = null;
    }
    let proc;
    try {
      proc = pty.spawn(CLAUDE_PATH, claudeArgs, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: ROOT,
        env: cleanEnv
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
  spawnPty();
  ws.on("message", (data) => {
    const msg = data.toString();
    if (msg.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "restart") {
          console.log("[terminal] In-band restart requested");
          spawnPty();
          return;
        }
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          ptyProcess?.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
      }
    }
    ptyProcess?.write(msg);
  });
  ws.on("close", () => {
    if (ptyProcess) {
      activePtys.delete(ptyProcess);
      ptyProcess.kill();
      ptyProcess = null;
    }
  });
  ws.on("error", () => {
    if (ptyProcess) {
      activePtys.delete(ptyProcess);
      ptyProcess.kill();
      ptyProcess = null;
    }
  });
});
function shutdown() {
  for (const p of activePtys) p.kill();
  wss.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
