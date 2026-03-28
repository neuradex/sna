import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { logger } from "../../lib/logger.js";
const SHELL = process.env.SHELL || "/bin/zsh";
function resolveClaudePath(cwd) {
  const cached = path.join(cwd, ".sna/claude-path");
  if (fs.existsSync(cached)) {
    const p = fs.readFileSync(cached, "utf8").trim();
    if (p) {
      try {
        execSync(`test -x "${p}"`, { stdio: "pipe" });
        return p;
      } catch {
      }
    }
  }
  for (const p of [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`
  ]) {
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
class ClaudeCodeProcess {
  constructor(proc, options) {
    this.emitter = new EventEmitter();
    this._alive = true;
    this._sessionId = null;
    this.buffer = "";
    this.proc = proc;
    proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        logger.log("stdout", line);
        try {
          const msg = JSON.parse(line);
          if (msg.session_id && !this._sessionId) {
            this._sessionId = msg.session_id;
          }
          const event = this.normalizeEvent(msg);
          if (event) this.emitter.emit("event", event);
        } catch {
        }
      }
    });
    proc.stderr.on("data", () => {
    });
    proc.on("exit", (code) => {
      this._alive = false;
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer);
          const event = this.normalizeEvent(msg);
          if (event) this.emitter.emit("event", event);
        } catch {
        }
      }
      this.emitter.emit("exit", code);
      logger.log("agent", `process exited (code=${code})`);
    });
    proc.on("error", (err) => {
      this._alive = false;
      this.emitter.emit("error", err);
    });
    if (options.prompt) {
      this.send(options.prompt);
    }
  }
  get alive() {
    return this._alive;
  }
  get sessionId() {
    return this._sessionId;
  }
  /**
   * Send a user message to the persistent Claude process via stdin.
   */
  send(input) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: input }
    });
    logger.log("stdin", msg.slice(0, 200));
    this.proc.stdin.write(msg + "\n");
  }
  kill() {
    if (this._alive) {
      this._alive = false;
      this.proc.kill("SIGTERM");
    }
  }
  on(event, handler) {
    this.emitter.on(event, handler);
  }
  off(event, handler) {
    this.emitter.off(event, handler);
  }
  normalizeEvent(msg) {
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") {
          return {
            type: "init",
            message: `Agent ready (${msg.model ?? "unknown"})`,
            data: { sessionId: msg.session_id, model: msg.model },
            timestamp: Date.now()
          };
        }
        return null;
      }
      case "assistant": {
        const content = msg.message?.content;
        if (!Array.isArray(content)) return null;
        const events = [];
        for (const block of content) {
          if (block.type === "thinking") {
            events.push({
              type: "thinking",
              message: block.thinking ?? "",
              timestamp: Date.now()
            });
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool_use",
              message: block.name,
              data: { toolName: block.name, input: block.input, id: block.id },
              timestamp: Date.now()
            });
          } else if (block.type === "text") {
            const text = (block.text ?? "").trim();
            if (text) {
              events.push({ type: "assistant", message: text, timestamp: Date.now() });
            }
          }
        }
        if (events.length > 0) {
          for (let i = 1; i < events.length; i++) {
            this.emitter.emit("event", events[i]);
          }
          return events[0];
        }
        return null;
      }
      case "user": {
        const userContent = msg.message?.content;
        if (!Array.isArray(userContent)) return null;
        for (const block of userContent) {
          if (block.type === "tool_result") {
            return {
              type: "tool_result",
              message: typeof block.content === "string" ? block.content.slice(0, 300) : JSON.stringify(block.content).slice(0, 300),
              data: { toolUseId: block.tool_use_id, isError: block.is_error },
              timestamp: Date.now()
            };
          }
        }
        return null;
      }
      case "result": {
        if (msg.subtype === "success") {
          const mu = msg.modelUsage ?? {};
          const modelKey = Object.keys(mu)[0] ?? "";
          const u = mu[modelKey] ?? {};
          return {
            type: "complete",
            message: msg.result ?? "Done",
            data: {
              durationMs: msg.duration_ms,
              costUsd: msg.total_cost_usd,
              inputTokens: u.inputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
              cacheReadTokens: u.cacheReadInputTokens ?? 0,
              cacheWriteTokens: u.cacheCreationInputTokens ?? 0,
              contextWindow: u.contextWindow ?? 0,
              maxOutputTokens: u.maxOutputTokens ?? 0,
              model: modelKey
            },
            timestamp: Date.now()
          };
        }
        if (msg.subtype === "error" || msg.is_error) {
          return {
            type: "error",
            message: msg.result ?? msg.error ?? "Unknown error",
            timestamp: Date.now()
          };
        }
        return null;
      }
      case "rate_limit_event":
        return null;
      default:
        logger.log("agent", `unhandled event: ${msg.type}`, JSON.stringify(msg).substring(0, 200));
        return null;
    }
  }
}
class ClaudeCodeProvider {
  constructor() {
    this.name = "claude-code";
  }
  async isAvailable() {
    try {
      const p = resolveClaudePath(process.cwd());
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
  spawn(options) {
    const claudePath = resolveClaudePath(options.cwd);
    const args = [
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose"
    ];
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    }
    const cleanEnv = { ...process.env, ...options.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
    const proc = spawn(claudePath, args, {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    logger.log("agent", `spawned claude-code (pid=${proc.pid})`);
    return new ClaudeCodeProcess(proc, options);
  }
}
export {
  ClaudeCodeProvider
};
