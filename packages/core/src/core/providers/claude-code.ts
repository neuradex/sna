import { spawn, execSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AgentProvider, AgentProcess, AgentEvent, SpawnOptions } from "./types.js";
import { writeHistoryJsonl, buildRecalledConversation } from "./cc-history-adapter.js";
import { logger } from "../../lib/logger.js";

const SHELL = process.env.SHELL || "/bin/zsh";

// ── Claude binary resolution ─────────────────────────────────────────────────

/**
 * Parse `command -v claude` output to extract the executable path.
 * Handles: direct paths, alias with/without quotes, bare command names.
 * @internal Exported for testing only.
 */
export function parseCommandVOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "claude";

  // "alias claude=/opt/homebrew/bin/claude"
  // "alias claude='/opt/homebrew/bin/claude'"
  // "alias claude=\"/opt/homebrew/bin/claude\""
  const aliasMatch = trimmed.match(/=\s*['"]?([^'"]+?)['"]?\s*$/);
  if (aliasMatch) return aliasMatch[1];

  // "/Users/.../bin/claude" — direct absolute path
  const pathMatch = trimmed.match(/^(\/\S+)/m);
  if (pathMatch) return pathMatch[1];

  // Bare "claude" or unrecognized format
  return trimmed;
}

function resolveClaudePath(cwd: string): string {
  // SNA_CLAUDE_COMMAND overrides everything (e.g., "sna tu claude" for testing)
  if (process.env.SNA_CLAUDE_COMMAND) {
    logger.log("agent", `claude path: SNA_CLAUDE_COMMAND=${process.env.SNA_CLAUDE_COMMAND}`);
    return process.env.SNA_CLAUDE_COMMAND;
  }

  const cached = path.join(cwd, ".sna/claude-path");
  if (fs.existsSync(cached)) {
    const p = fs.readFileSync(cached, "utf8").trim();
    if (p) {
      try { execSync(`test -x "${p}"`, { stdio: "pipe" }); logger.log("agent", `claude path: cached=${p}`); return p; } catch { /* stale */ }
    }
  }

  const staticPaths = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
    `${process.env.HOME}/.claude/bin/claude`,
    `${process.env.HOME}/.volta/bin/claude`,
  ];
  for (const p of staticPaths) {
    try { execSync(`test -x "${p}"`, { stdio: "pipe" }); logger.log("agent", `claude path: static=${p}`); return p; } catch { /* next */ }
  }

  // Try login shell to pick up nvm/fnm/asdf managed paths
  try {
    const raw = execSync(`${SHELL} -i -l -c "command -v claude" 2>/dev/null`, { encoding: "utf8", timeout: 5000 }).trim();
    const resolved = parseCommandVOutput(raw);
    logger.log("agent", `claude path: shell raw="${raw}" → resolved="${resolved}"`);
    return resolved;
  } catch (err: any) {
    logger.err("agent", `claude path: all methods failed (SHELL=${SHELL}, HOME=${process.env.HOME}, err=${err.message})`);
    logger.err("agent", `claude path: tried static=[${staticPaths.join(", ")}]`);
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
  private _initEmitted = false;
  private buffer = "";
  /** True once we receive a real text_delta stream_event this turn */
  private _receivedStreamEvents = false;
  /** tool_use IDs already emitted via stream_event (to update instead of re-create in assistant block) */
  private _streamedToolUseIds = new Set<string>();

  /**
   * FIFO event queue — ALL events (deltas, assistant, complete, etc.) go through
   * this queue. A fixed-interval timer drains one item at a time, guaranteeing
   * strict ordering: deltas → assistant → complete, never out of order.
   */
  private eventQueue: AgentEvent[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly DRAIN_INTERVAL_MS = 15; // ~67 events/sec

  /**
   * Enqueue an event for ordered emission.
   * Starts the drain timer if not already running.
   */
  private enqueue(event: AgentEvent): void {
    this.eventQueue.push(event);
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.drainOne(), ClaudeCodeProcess.DRAIN_INTERVAL_MS);
    }
  }

  /** Emit one event from the front of the queue. Stop timer when empty. */
  private drainOne(): void {
    const event = this.eventQueue.shift();
    if (event) {
      this.emitter.emit("event", event);
    }
    if (this.eventQueue.length === 0 && this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  /** Flush all remaining queued events immediately (used on process exit). */
  private flushQueue(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    while (this.eventQueue.length > 0) {
      this.emitter.emit("event", this.eventQueue.shift()!);
    }
  }

  /**
   * Split completed assistant text into delta chunks and enqueue them,
   * followed by the final assistant event. All go through the FIFO queue
   * so subsequent events (complete, etc.) are guaranteed to come after.
   */
  private enqueueTextAsDeltas(text: string): void {
    const CHUNK_SIZE = 4;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      this.enqueue({
        type: "assistant_delta",
        delta: text.slice(i, i + CHUNK_SIZE),
        index: 0,
        timestamp: Date.now(),
      } satisfies AgentEvent);
    }
    this.enqueue({
      type: "assistant",
      message: text,
      timestamp: Date.now(),
    } satisfies AgentEvent);
  }

  get alive() { return this._alive; }
  get pid() { return this.proc.pid ?? null; }
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
          if (event) this.enqueue(event);
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
          if (event) this.enqueue(event);
        } catch { /* ignore */ }
      }
      // Flush all queued events before emitting exit
      this.flushQueue();
      this.emitter.emit("exit", code);
      logger.log("agent", `process exited (code=${code})`);
    });

    proc.on("error", (err) => {
      this._alive = false;
      this.emitter.emit("error", err);
    });

    // Inject conversation history.
    // Primary: JSONL resume (real multi-turn structure).
    // Fallback: recalled-conversation (single assistant message with XML).
    // Note: JSONL resume args are added by the caller (spawn method) before
    // the process is created, so here we only handle the fallback case.
    if (options.history?.length && !options._historyViaResume) {
      // Fallback: recalled-conversation as single assistant message.
      // Works with or without prompt — if no prompt, CC enters waiting state.
      const line = buildRecalledConversation(options.history);
      this.proc.stdin!.write(line + "\n");
    }

    // Send initial prompt if provided
    if (options.prompt) {
      this.send(options.prompt);
    }
  }

  /**
   * Send a user message to the persistent Claude process via stdin.
   * Accepts plain string or content block array (text + images).
   */
  send(input: string | import("./types.js").ContentBlock[]): void {
    if (!this._alive || !this.proc.stdin!.writable) return;
    const content = typeof input === "string" ? input : input;
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content },
    });
    logger.log("stdin", msg.slice(0, 200));
    this.proc.stdin!.write(msg + "\n");
  }

  interrupt(): void {
    if (!this._alive || !this.proc.stdin!.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "interrupt" },
    });
    this.proc.stdin!.write(msg + "\n");
  }

  setModel(model: string): void {
    if (!this._alive || !this.proc.stdin!.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "set_model", model },
    });
    this.proc.stdin!.write(msg + "\n");
  }

  setPermissionMode(mode: string): void {
    if (!this._alive || !this.proc.stdin!.writable) return;
    const msg = JSON.stringify({
      type: "control_request",
      request: { subtype: "set_permission_mode", permission_mode: mode },
    });
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
          // Emit first init, suppress duplicates after interrupt (same session re-initializes)
          if (this._initEmitted) return null;
          this._initEmitted = true;
          return {
            type: "init",
            message: `Agent ready (${msg.model ?? "unknown"})`,
            data: { sessionId: msg.session_id, model: msg.model },
            timestamp: Date.now(),
          };
        }
        return null;
      }

      case "stream_event": {
        const inner = msg.event;
        if (!inner) return null;
        if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
          const block = inner.content_block;
          this._receivedStreamEvents = true;
          this._streamedToolUseIds.add(block.id);
          return {
            type: "tool_use",
            message: block.name,
            data: { toolName: block.name, id: block.id, input: null, streaming: true },
            timestamp: Date.now(),
          } satisfies AgentEvent;
        }
        if (inner.type === "content_block_delta") {
          const delta = inner.delta;
          if (delta?.type === "text_delta" && delta.text) {
            this._receivedStreamEvents = true;
            return {
              type: "assistant_delta",
              delta: delta.text,
              index: inner.index ?? 0,
              timestamp: Date.now(),
            } satisfies AgentEvent;
          }
          if (delta?.type === "thinking_delta" && delta.thinking) {
            return {
              type: "thinking_delta",
              message: delta.thinking,
              timestamp: Date.now(),
            } satisfies AgentEvent;
          }
        }
        return null;
      }

      case "assistant": {
        // With --include-partial-messages, intermediate snapshots have stop_reason: null.
        // Skip them — real deltas already came via stream_event above.
        if (this._receivedStreamEvents && msg.message?.stop_reason === null) return null;

        const content = msg.message?.content;
        if (!Array.isArray(content)) return null;

        const events: AgentEvent[] = [];
        const textBlocks: string[] = [];

        for (const block of content) {
          if (block.type === "thinking") {
            events.push({
              type: "thinking",
              message: block.thinking ?? "",
              timestamp: Date.now(),
            });
          } else if (block.type === "tool_use") {
            const alreadyStreamed = this._streamedToolUseIds.has(block.id);
            if (alreadyStreamed) this._streamedToolUseIds.delete(block.id);
            events.push({
              type: "tool_use",
              message: block.name,
              data: { toolName: block.name, input: block.input, id: block.id, update: alreadyStreamed },
              timestamp: Date.now(),
            });
          } else if (block.type === "text") {
            const text = (block.text ?? "").trim();
            if (text) {
              // Schedule after synchronous events so thinking/tool_use emit first
              textBlocks.push(text);
            }
          }
        }

        if (events.length > 0 || textBlocks.length > 0) {
          for (const e of events) {
            this.enqueue(e);
          }
          for (const text of textBlocks) {
            // this.enqueueTextAsDeltas(text); // synthetic delta fallback — disabled in favour of --include-partial-messages
            this.enqueue({ type: "assistant", message: text, timestamp: Date.now() } satisfies AgentEvent);
          }
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
          // If we were in streaming mode, emit the full assistant text before complete
          if (this._receivedStreamEvents && msg.result) {
            this.enqueue({
              type: "assistant",
              message: msg.result,
              timestamp: Date.now(),
            } satisfies AgentEvent);
            this._receivedStreamEvents = false;
            this._streamedToolUseIds.clear();
          }
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
        // error_during_execution with is_error=false → user-initiated interrupt
        if (msg.subtype === "error_during_execution" && msg.is_error === false) {
          return {
            type: "interrupted",
            message: "Turn interrupted by user",
            data: { durationMs: msg.duration_ms, costUsd: msg.total_cost_usd },
            timestamp: Date.now(),
          };
        }
        if (msg.subtype?.startsWith("error") || msg.is_error) {
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
    const claudeCommand = resolveClaudePath(options.cwd);
    // SNA_CLAUDE_COMMAND can be multi-word (e.g., "node sna.ts tu claude")
    const claudeParts = claudeCommand.split(/\s+/);
    const claudePath = claudeParts[0]!;
    const claudePrefix = claudeParts.slice(1);

    // Build merged settings: SDK's PreToolUse hook + app's settings from extraArgs.
    // Skip hook injection when bypassPermissions is set — all tools are auto-allowed.
    // Resolve hook script by walking up to the package root (where package.json lives).
    // import.meta.url varies depending on whether this code runs from the bundled
    // standalone (dist/server/standalone.js) or individual file (dist/core/providers/claude-code.js).
    let pkgRoot = path.dirname(fileURLToPath(import.meta.url));
    while (!fs.existsSync(path.join(pkgRoot, "package.json"))) {
      const parent = path.dirname(pkgRoot);
      if (parent === pkgRoot) break;
      pkgRoot = parent;
    }
    const hookScript = path.join(pkgRoot, "dist", "scripts", "hook.js");
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
      "--include-partial-messages",
      "--settings", JSON.stringify(sdkSettings),
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    }

    // History injection: write JSONL file, pass --resume <filepath>
    if (options.history?.length && options.prompt) {
      const result = writeHistoryJsonl(options.history, { cwd: options.cwd });
      if (result) {
        args.push(...result.extraArgs);
        options._historyViaResume = true;
        logger.log("agent", `history via JSONL resume → ${result.filePath}`);
      }
    }

    if (extraArgsClean.length > 0) {
      args.push(...extraArgsClean);
    }

    const cleanEnv = { ...process.env, ...options.env } as Record<string, string>;
    if (options.configDir) {
      cleanEnv.CLAUDE_CONFIG_DIR = options.configDir;
    }
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

    // Ensure the Claude binary's directory is in PATH so its shebang (#!/usr/bin/env node) works.
    // Critical for nvm/fnm/asdf installs where node isn't in Electron's default PATH.
    const claudeDir = path.dirname(claudePath);
    if (claudeDir && claudeDir !== ".") {
      cleanEnv.PATH = `${claudeDir}:${cleanEnv.PATH ?? ""}`;
    }

    const proc = spawn(claudePath, [...claudePrefix, ...args], {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    logger.log("agent", `spawned claude-code (pid=${proc.pid}) → ${claudeCommand} ${args.join(" ")}`);

    return new ClaudeCodeProcess(proc, options);
  }
}
