/**
 * Grok Build (xAI) provider — ACP-over-stdio adapter.
 *
 * Backed by the Grok Build CLI's `grok agent stdio` subcommand, which
 * implements the Agent Client Protocol (ACP, https://agentclientprotocol.com)
 * as a JSON-RPC 2.0 stream over stdin/stdout.
 *
 * The bulk of the wire handling lives in `acp/base.ts` (shared with Cursor).
 * This file is the Grok Build-specific subclass + provider entry: CLI path
 * resolution, top-level flag composition, MCP bridge setup via
 * `<cwd>/.grok/config.toml`, `_x.ai/*` extension drop, and the `use_tool`
 * dispatch unwrap that surfaces the real MCP tool name behind grok's
 * generic dispatcher.
 *
 * Note on product naming: throughout this file, `grok` (lowercase) refers
 * to the CLI binary / registry key only. The xAI product itself is "Grok
 * Build" — that's what user-facing documentation should call it, just as
 * "Claude Code" is the product name behind the `claude` binary.
 *
 * Design decisions specific to Grok Build (the shared ACP decisions are
 * captured at the top of `acp/base.ts`):
 *
 *   • MCP via `<cwd>/.grok/config.toml`. Grok advertises only `{http,sse}`
 *     in `initialize.mcpCapabilities` and rejects every non-empty shape
 *     passed to `session/new.mcpServers`. Stdio MCP servers (Loom's
 *     workflow today) are bridged to HTTP via `stdio-http-bridge.ts`
 *     and written into a project-scoped TOML the daemon reads at startup.
 *     The original config (if any) is restored on exit.
 *
 *   • `_x.ai/*` extension notifications are dropped on the floor.
 *
 *   • `use_tool` unwrap. Grok dispatches every external MCP call through
 *     its internal `use_tool` tool with the real tool name + arguments
 *     nested as `rawInput.tool_name` and `rawInput.tool_input`. We
 *     surface the canonical name directly so downstream
 *     `isToolName(name, "board_item_add")` checks behave the same way
 *     they do for claude / codex / opencode.
 *
 *   • Reasoning level uses the same 5-step table as Claude Code (low / low
 *     / medium / high / xhigh / max).
 */

import { spawn, execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { bridgeStdioMcpToHttp, type BridgeHandle } from "../mcp/stdio-http-bridge.js";
import type {
  AgentProvider,
  AgentProcess,
  SpawnOptions,
  CompleteOptions,
  CompletionResult,
  ListModelsConfig,
  ListModelsResult,
  RuntimeModelInfo,
} from "./types.js";
import { logger } from "../../lib/logger.js";
import { toGrokEffort } from "./reasoning-level.js";
import {
  AcpStdioProcess,
  type AcpSpawnDescriptor,
  type AcpSessionUpdate,
  type UnwrappedToolCall,
} from "./acp/base.js";

// ── CLI discovery ────────────────────────────────────────────────────────────

export function resolveGrokPath(_cwd: string = process.cwd()): string {
  if (process.env.SNA_GROK_COMMAND) return process.env.SNA_GROK_COMMAND;
  const home = process.env.HOME ?? "";
  const candidates = [
    `${home}/.local/bin/grok`,
    "/usr/local/bin/grok",
    "/opt/homebrew/bin/grok",
  ];
  for (const p of candidates) {
    try {
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return p;
    } catch {
      // try next
    }
  }
  return "grok";
}

// ── Process ─────────────────────────────────────────────────────────────────

export class GrokProcess extends AcpStdioProcess {
  /**
   * stdio→HTTP MCP bridges spun up for this session. Each one owns its
   * own child process + listener; disposed on grok exit so we don't
   * leak sockets between sessions.
   */
  private mcpBridges: BridgeHandle[] = [];
  /**
   * Path to the `.grok/config.toml` we wrote so cleanup can restore it.
   * The snapshot is the file's contents *before* we touched it (null when
   * we created it from scratch — cleanup then deletes it instead of
   * restoring).
   */
  private grokConfigRestore: { path: string; original: string | null } | null = null;

  protected get name(): string { return "grok"; }

  protected get vendorNotificationPrefix(): string { return "_x.ai/"; }

  protected resolveSpawn(options: SpawnOptions): AcpSpawnDescriptor {
    // `grok agent stdio` accepts provider/runtime flags on the `agent`
    // command, before the terminal `stdio` subcommand. The `stdio`
    // subcommand itself takes no options.
    const args: string[] = ["agent"];
    const providerOptions = options.providerOptions ?? {};
    const xaiApiBaseUrl = providerOptions.xaiApiBaseUrl;
    const cliChatProxyBaseUrl = providerOptions.cliChatProxyBaseUrl;
    if (providerOptions.noLeader === true) {
      args.push("--no-leader");
    }
    if (typeof xaiApiBaseUrl === "string" && xaiApiBaseUrl.trim()) {
      args.push("--xai-api-base-url", xaiApiBaseUrl);
    }
    if (typeof cliChatProxyBaseUrl === "string" && cliChatProxyBaseUrl.trim()) {
      args.push("--cli-chat-proxy-base-url", cliChatProxyBaseUrl);
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.reasoningLevel !== undefined) {
      args.push("--effort", toGrokEffort(options.reasoningLevel));
    }
    if (options.permissionMode === "bypassPermissions") {
      args.push("--always-approve");
    }
    args.push("stdio");
    return { command: resolveGrokPath(options.cwd), args };
  }

  protected async preHandshake(options: SpawnOptions): Promise<void> {
    await this.setupMcpBridges(options);
  }

  protected onExit(_code: number | null): void {
    this.disposeMcpBridges();
  }

  protected onPreSpawnCleanup(): void {
    this.disposeMcpBridges();
  }

  /**
   * Grok wraps every external MCP call in its internal `use_tool` dispatch
   * with the real tool name nested in `rawInput.tool_name`. Unwrap so
   * downstream consumers see the canonical name.
   */
  protected unwrapToolCall(update: AcpSessionUpdate): UnwrappedToolCall {
    const raw = update.rawInput as { tool_name?: string; tool_input?: unknown } | undefined;
    const isUseTool = !!(raw && typeof raw.tool_name === "string");
    const toolName = isUseTool ? raw!.tool_name! : (update.title ?? "tool");
    const input = isUseTool ? raw!.tool_input : update.rawInput;
    return {
      toolName,
      input,
      // Preserve grok's human-readable dispatch title for debug overlays/tooltips.
      extra: update.title ? { grokTitle: update.title } : undefined,
    };
  }

  /**
   * Spin up HTTP bridges for each stdio MCP entry and inject
   * `[mcp_servers.<name>]` blocks into the project-scoped config at
   * `<cwd>/.grok/config.toml`. We use the project-scoped file (not the
   * global ~/.grok/config.toml) so concurrent sessions don't fight over
   * the same file. The original contents (or "no such file") are
   * remembered for restore on exit.
   *
   * Entries already declared as `{type:"http",url:...}` are passed through
   * verbatim — no bridge needed. Other shapes are dropped with a log.
   */
  private async setupMcpBridges(options: SpawnOptions): Promise<void> {
    if (!options.mcpServers) return;

    type Entry = { name: string; url: string; headers?: Record<string, string> };
    const entries: Entry[] = [];

    for (const [name, cfg] of Object.entries(options.mcpServers)) {
      if (!cfg || typeof cfg !== "object") continue;

      if ("type" in cfg && cfg.type === "http") {
        entries.push({ name, url: cfg.url, headers: cfg.headers });
        continue;
      }
      if ("command" in cfg && cfg.command) {
        const handle = await bridgeStdioMcpToHttp(name, {
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
          cwd: cfg.cwd ?? options.cwd,
        });
        this.mcpBridges.push(handle);
        entries.push({ name, url: handle.url });
        continue;
      }
      logger.log("agent", `grok: skipping mcp server '${name}' — unsupported shape`);
    }

    if (entries.length === 0) return;

    const cfgDir = path.join(options.cwd, ".grok");
    const cfgPath = path.join(cfgDir, "config.toml");
    let original: string | null = null;
    try { original = fs.readFileSync(cfgPath, "utf-8"); } catch { /* no file yet */ }
    try { fs.mkdirSync(cfgDir, { recursive: true }); } catch {}

    const block = entries.map((e) => {
      const lines = [`[mcp_servers.${e.name}]`, `url = ${JSON.stringify(e.url)}`];
      if (e.headers) {
        lines.push(`[mcp_servers.${e.name}.headers]`);
        for (const [k, v] of Object.entries(e.headers)) {
          lines.push(`${k} = ${JSON.stringify(v)}`);
        }
      }
      return lines.join("\n");
    }).join("\n\n");

    const marker = `# sna-grok-bridge:BEGIN\n${block}\n# sna-grok-bridge:END\n`;
    const next = (original ?? "").replace(/\n*# sna-grok-bridge:BEGIN[\s\S]*?# sna-grok-bridge:END\n?/g, "");
    fs.writeFileSync(cfgPath, (next ? next.replace(/\n*$/, "\n\n") : "") + marker);

    this.grokConfigRestore = { path: cfgPath, original };
    logger.log("agent", `grok: wrote ${entries.length} mcp_servers entries to ${cfgPath}`);
  }

  private disposeMcpBridges(): void {
    for (const b of this.mcpBridges) {
      try { b.dispose(); } catch {}
    }
    this.mcpBridges = [];

    const restore = this.grokConfigRestore;
    this.grokConfigRestore = null;
    if (!restore) return;
    try {
      if (restore.original === null) {
        fs.unlinkSync(restore.path);
      } else {
        fs.writeFileSync(restore.path, restore.original);
      }
    } catch (err) {
      logger.log("agent", `grok: failed to restore ${restore.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export class GrokProvider implements AgentProvider {
  readonly name = "grok";
  readonly supportsRuntimePooling = false;

  async isAvailable(): Promise<boolean> {
    try {
      const p = resolveGrokPath(process.cwd());
      execSync(`"${p}" --version`, { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(options: SpawnOptions): AgentProcess {
    logger.log("agent", `grok: spawn cwd=${options.cwd} model=${options.model ?? "default"}`);
    return new GrokProcess(options);
  }

  async complete(options: CompleteOptions): Promise<CompletionResult> {
    // One-shot path uses `grok -p` headless mode. We bypass the ACP stdio
    // pump entirely — for stateless text-in/text-out calls (e.g. session
    // title generation) there's no need to spin up an ACP session.
    const grokPath = resolveGrokPath(options.cwd);
    const cwd = options.cwd ?? process.cwd();

    // Streaming via onDelta uses --output-format streaming-json. The probe
    // showed that streaming-json omits tool_call events — fine for
    // complete() which is text-only — but yields {type, data} text/thought
    // chunks we can dispatch immediately.
    const streaming = typeof options.onDelta === "function";
    const args = [
      "-p", options.prompt,
      "--output-format", streaming ? "streaming-json" : "json",
    ];
    if (options.model) args.push("--model", options.model);
    if (options.reasoningLevel !== undefined) {
      args.push("--reasoning-effort", toGrokEffort(options.reasoningLevel));
    }
    if (options.systemPrompt) {
      args.push("--system-prompt-override", options.systemPrompt);
    }
    if (options.appendSystemPrompt) {
      args.push("--rules", options.appendSystemPrompt);
    }
    if (options.extraArgs) args.push(...options.extraArgs);

    const timeout = options.timeout ?? 60_000;
    const model = options.model ?? "grok-build";

    logger.log(
      "agent",
      `complete: provider=grok model=${model} prompt="${options.prompt.slice(0, 60)}..."`,
    );

    return new Promise<CompletionResult>((resolve, reject) => {
      const start = Date.now();
      const proc = spawn(grokPath, args, {
        cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let streamBuf = "";

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`grok complete timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout!.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (!streaming) return;
        streamBuf += text;
        const lines = streamBuf.split("\n");
        streamBuf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try {
            const evt = JSON.parse(t) as { type?: string; data?: string };
            if (evt.type === "text" && typeof evt.data === "string" && options.onDelta) {
              try {
                options.onDelta(evt.data);
              } catch (cbErr) {
                clearTimeout(timer);
                proc.kill();
                reject(cbErr instanceof Error ? cbErr : new Error(String(cbErr)));
                return;
              }
            }
          } catch {
            // ignore malformed lines
          }
        }
      });

      proc.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on("exit", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        if (code !== 0) {
          const stderrTail = stderr.trim().split("\n").slice(-3).join(" | ");
          reject(new Error(`grok exited with code ${code}: ${stderrTail || "(no stderr)"}`));
          return;
        }

        let resultText = "";
        let stopReason: string | undefined;
        let sessionId: string | undefined;
        try {
          if (streaming) {
            // Aggregate text deltas; the final `{"type":"end", ...}` event
            // carries stopReason + sessionId.
            const lines = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
            const parts: string[] = [];
            for (const line of lines) {
              const evt = JSON.parse(line) as { type?: string; data?: string; stopReason?: string; sessionId?: string };
              if (evt.type === "text" && typeof evt.data === "string") parts.push(evt.data);
              if (evt.type === "end") {
                stopReason = evt.stopReason;
                sessionId = evt.sessionId;
              }
            }
            resultText = parts.join("");
          } else {
            const parsed = JSON.parse(stdout) as { text?: string; stopReason?: string; sessionId?: string };
            resultText = parsed.text ?? "";
            stopReason = parsed.stopReason;
            sessionId = parsed.sessionId;
          }
        } catch (err) {
          reject(new Error(`grok complete: failed to parse stdout: ${err instanceof Error ? err.message : String(err)}`));
          return;
        }

        void stopReason;
        void sessionId;

        resolve({
          text: resultText,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          },
          costUsd: 0,
          durationMs,
          durationApiMs: durationMs,
          model,
        });
      });
    });
  }

  async listModels(_config?: ListModelsConfig): Promise<ListModelsResult> {
    // grok exposes its catalog via `grok models` (human-readable). The JSON
    // contract is unstable, so we hard-code the single model we have
    // observed (grok-build, 512k ctx). Refresh this when xAI adds more.
    const model: RuntimeModelInfo = {
      id: "grok-build",
      label: "Grok Build",
      provider: "xai",
      source: "static",
      contextWindow: 512_000,
    };
    return { models: [model], source: "static", fetchedAt: Date.now() };
  }
}

/**
 * Backwards-compat export for the history serializer used inside the
 * original GrokProcess. The base now provides `serializeHistoryForAcp()`
 * (functionally identical); this thin re-export keeps the public symbol
 * stable for any external callers that imported it from this module.
 */
export { serializeHistoryForAcp as serializeHistoryForGrok } from "./acp/base.js";
