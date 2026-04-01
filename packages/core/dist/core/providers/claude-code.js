import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { writeHistoryJsonl, buildRecalledConversation } from "./cc-history-adapter.js";
import { logger } from "../../lib/logger.js";
const SHELL = process.env.SHELL || "/bin/zsh";
function resolveClaudePath(cwd) {
  if (process.env.SNA_CLAUDE_COMMAND) return process.env.SNA_CLAUDE_COMMAND;
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
    this._initEmitted = false;
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
    if (options.history?.length && !options._historyViaResume) {
      const line = buildRecalledConversation(options.history);
      this.proc.stdin.write(line + "\n");
    }
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
   * Accepts plain string or content block array (text + images).
   */
  send(input) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const content = typeof input === "string" ? input : input;
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content }
    });
    logger.log("stdin", msg.slice(0, 200));
    this.proc.stdin.write(msg + "\n");
  }
  interrupt() {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "interrupt" }
    });
    this.proc.stdin.write(msg + "\n");
  }
  setModel(model) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "set_model", model }
    });
    this.proc.stdin.write(msg + "\n");
  }
  setPermissionMode(mode) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "set_permission_mode", permission_mode: mode }
    });
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
          if (this._initEmitted) return null;
          this._initEmitted = true;
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
          const u = msg.usage ?? {};
          const mu = msg.modelUsage ?? {};
          const modelKey = Object.keys(mu)[0] ?? "";
          const modelInfo = mu[modelKey] ?? {};
          return {
            type: "complete",
            message: msg.result ?? "Done",
            data: {
              durationMs: msg.duration_ms,
              costUsd: msg.total_cost_usd,
              // Per-turn: actual context window usage this turn
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              cacheReadTokens: u.cache_read_input_tokens ?? 0,
              cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
              // Static model info
              contextWindow: modelInfo.contextWindow ?? 0,
              model: modelKey
            },
            timestamp: Date.now()
          };
        }
        if (msg.subtype === "error_during_execution" && msg.is_error === false) {
          return {
            type: "interrupted",
            message: "Turn interrupted by user",
            data: { durationMs: msg.duration_ms, costUsd: msg.total_cost_usd },
            timestamp: Date.now()
          };
        }
        if (msg.subtype?.startsWith("error") || msg.is_error) {
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
    const claudeCommand = resolveClaudePath(options.cwd);
    const claudeParts = claudeCommand.split(/\s+/);
    const claudePath = claudeParts[0];
    const claudePrefix = claudeParts.slice(1);
    const hookScript = new URL("../../scripts/hook.js", import.meta.url).pathname;
    const sessionId = options.env?.SNA_SESSION_ID ?? "default";
    const sdkSettings = {};
    if (options.permissionMode !== "bypassPermissions") {
      sdkSettings.hooks = {
        PreToolUse: [{
          matcher: ".*",
          hooks: [{ type: "command", command: `node "${hookScript}" --session=${sessionId}` }]
        }]
      };
    }
    let extraArgsClean = options.extraArgs ? [...options.extraArgs] : [];
    const settingsIdx = extraArgsClean.indexOf("--settings");
    if (settingsIdx !== -1 && settingsIdx + 1 < extraArgsClean.length) {
      try {
        const appSettings = JSON.parse(extraArgsClean[settingsIdx + 1]);
        if (appSettings.hooks) {
          for (const [event, hooks] of Object.entries(appSettings.hooks)) {
            if (sdkSettings.hooks && sdkSettings.hooks[event]) {
              sdkSettings.hooks[event] = [
                ...sdkSettings.hooks[event],
                ...hooks
              ];
            } else {
              sdkSettings.hooks[event] = hooks;
            }
          }
          delete appSettings.hooks;
        }
        Object.assign(sdkSettings, appSettings);
      } catch {
      }
      extraArgsClean.splice(settingsIdx, 2);
    }
    const args = [
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--settings",
      JSON.stringify(sdkSettings)
    ];
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    }
    if (options.history?.length && options.prompt) {
      const result = writeHistoryJsonl(options.history, { cwd: options.cwd });
      if (result) {
        args.push(...result.extraArgs);
        options._historyViaResume = true;
        logger.log("agent", `history via JSONL resume \u2192 ${result.filePath}`);
      }
    }
    if (extraArgsClean.length > 0) {
      args.push(...extraArgsClean);
    }
    const cleanEnv = { ...process.env, ...options.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
    const proc = spawn(claudePath, [...claudePrefix, ...args], {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    logger.log("agent", `spawned claude-code (pid=${proc.pid}) \u2192 ${claudeCommand} ${args.join(" ")}`);
    return new ClaudeCodeProcess(proc, options);
  }
}
export {
  ClaudeCodeProvider
};
