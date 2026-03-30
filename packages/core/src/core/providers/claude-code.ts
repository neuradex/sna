import { spawn, execSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import type { AgentProvider, AgentProcess, AgentEvent, SpawnOptions } from "./types.js";
import { logger } from "../../lib/logger.js";

const SHELL = process.env.SHELL || "/bin/zsh";

// ── Claude binary resolution ─────────────────────────────────────────────────

function resolveClaudePath(cwd: string): string {
  const cached = path.join(cwd, ".sna/claude-path");
  if (fs.existsSync(cached)) {
    const p = fs.readFileSync(cached, "utf8").trim();
    if (p) {
      try { execSync(`test -x "${p}"`, { stdio: "pipe" }); return p; } catch { /* stale */ }
    }
  }
  for (const p of [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
  ]) {
    try { execSync(`test -x "${p}"`, { stdio: "pipe" }); return p; } catch { /* next */ }
  }
  try {
    return execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
  } catch {
    return "claude";
  }
}

// ── ClaudeCodeProcess ────────────────────────────────────────────────────────

/**
 * Persistent Claude Code process using `--input-format stream-json`.
 *
 * A single process stays alive for the entire session.
 * Messages are sent via stdin as NDJSON, responses come on stdout.
 *
 * stdin format:  {"type":"user","message":{"role":"user","content":"..."}}
 * stdout format: {"type":"system"|"assistant"|"result"|...}
 */
class ClaudeCodeProcess implements AgentProcess {
  private emitter = new EventEmitter();
  private proc: ChildProcess;
  private _alive = true;
  private _sessionId: string | null = null;
  private buffer = "";

  get alive() { return this._alive; }
  get sessionId() { return this._sessionId; }

  constructor(proc: ChildProcess, options: SpawnOptions) {
    this.proc = proc;

    proc.stdout!.on("data", (chunk: Buffer) => {
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
        } catch { /* non-JSON */ }
      }
    });

    proc.stderr!.on("data", () => {
      // Debug output — ignore
    });

    proc.on("exit", (code) => {
      this._alive = false;
      // Flush remaining buffer
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer);
          const event = this.normalizeEvent(msg);
          if (event) this.emitter.emit("event", event);
        } catch { /* ignore */ }
      }
      this.emitter.emit("exit", code);
      logger.log("agent", `process exited (code=${code})`);
    });

    proc.on("error", (err) => {
      this._alive = false;
      this.emitter.emit("error", err);
    });

    // Send initial prompt if provided
    if (options.prompt) {
      this.send(options.prompt);
    }
  }

  /**
   * Send a user message to the persistent Claude process via stdin.
   */
  send(input: string): void {
    if (!this._alive || !this.proc.stdin!.writable) return;
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: input },
    });
    logger.log("stdin", msg.slice(0, 200));
    this.proc.stdin!.write(msg + "\n");
  }

  kill(): void {
    if (this._alive) {
      this._alive = false;
      this.proc.kill("SIGTERM");
    }
  }

  on(event: string, handler: Function): void {
    this.emitter.on(event, handler as any);
  }

  off(event: string, handler: Function): void {
    this.emitter.off(event, handler as any);
  }

  private normalizeEvent(msg: any): AgentEvent | null {
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") {
          return {
            type: "init",
            message: `Agent ready (${msg.model ?? "unknown"})`,
            data: { sessionId: msg.session_id, model: msg.model },
            timestamp: Date.now(),
          };
        }
        return null;
      }

      case "assistant": {
        const content = msg.message?.content;
        if (!Array.isArray(content)) return null;

        const events: AgentEvent[] = [];

        for (const block of content) {
          if (block.type === "thinking") {
            events.push({
              type: "thinking",
              message: block.thinking ?? "",
              timestamp: Date.now(),
            });
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool_use",
              message: block.name,
              data: { toolName: block.name, input: block.input, id: block.id },
              timestamp: Date.now(),
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
        // Tool results come as user messages
        const userContent = msg.message?.content;
        if (!Array.isArray(userContent)) return null;
        for (const block of userContent) {
          if (block.type === "tool_result") {
            return {
              type: "tool_result" as const,
              message: typeof block.content === "string"
                ? block.content.slice(0, 300)
                : JSON.stringify(block.content).slice(0, 300),
              data: { toolUseId: block.tool_use_id, isError: block.is_error },
              timestamp: Date.now(),
            };
          }
        }
        return null;
      }

      case "result": {
        if (msg.subtype === "success") {
          // Per-turn usage — represents actual context size for this turn
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
              model: modelKey,
            },
            timestamp: Date.now(),
          };
        }
        if (msg.subtype === "error" || msg.is_error) {
          return {
            type: "error",
            message: msg.result ?? msg.error ?? "Unknown error",
            timestamp: Date.now(),
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

// ── ClaudeCodeProvider ───────────────────────────────────────────────────────

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = "claude-code";

  async isAvailable(): Promise<boolean> {
    try {
      const p = resolveClaudePath(process.cwd());
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  spawn(options: SpawnOptions): AgentProcess {
    const claudePath = resolveClaudePath(options.cwd);

    // Build merged settings: SDK's PreToolUse hook + app's settings from extraArgs.
    // Skip hook injection when bypassPermissions is set — all tools are auto-allowed.
    // Resolve hook script relative to this file (works with pnpm link / monorepo setups).
    const hookScript = new URL("../../scripts/hook.js", import.meta.url).pathname;
    const sessionId = options.env?.SNA_SESSION_ID ?? "default";
    const sdkSettings: Record<string, unknown> = {};

    if (options.permissionMode !== "bypassPermissions") {
      sdkSettings.hooks = {
        PreToolUse: [{
          matcher: ".*",
          hooks: [{ type: "command", command: `node "${hookScript}" --session=${sessionId}` }],
        }],
      };
    }

    // Extract --settings from extraArgs (if any) and merge
    let extraArgsClean = options.extraArgs ? [...options.extraArgs] : [];
    const settingsIdx = extraArgsClean.indexOf("--settings");
    if (settingsIdx !== -1 && settingsIdx + 1 < extraArgsClean.length) {
      try {
        const appSettings = JSON.parse(extraArgsClean[settingsIdx + 1]);
        // Merge hooks: SDK hooks + app hooks
        if (appSettings.hooks) {
          for (const [event, hooks] of Object.entries(appSettings.hooks)) {
            if (sdkSettings.hooks && (sdkSettings.hooks as Record<string, unknown[]>)[event]) {
              (sdkSettings.hooks as Record<string, unknown[]>)[event] = [
                ...(sdkSettings.hooks as Record<string, unknown[]>)[event],
                ...(hooks as unknown[]),
              ];
            } else {
              (sdkSettings.hooks as Record<string, unknown>)[event] = hooks;
            }
          }
          delete appSettings.hooks;
        }
        // Merge remaining top-level settings
        Object.assign(sdkSettings, appSettings);
      } catch { /* invalid JSON — ignore app settings */ }
      extraArgsClean.splice(settingsIdx, 2);
    }

    const args = [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--settings", JSON.stringify(sdkSettings),
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    }

    if (extraArgsClean.length > 0) {
      args.push(...extraArgsClean);
    }

    const cleanEnv = { ...process.env, ...options.env } as Record<string, string>;
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;

    const proc = spawn(claudePath, args, {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    logger.log("agent", `spawned claude-code (pid=${proc.pid}) → ${claudePath} ${args.join(" ")}`);

    return new ClaudeCodeProcess(proc, options);
  }
}
