/**
 * Cursor provider — ACP-over-stdio adapter, second provider on the shared
 * `AcpStdioProcess` base.
 *
 * Backed by Cursor's `cursor-agent acp` subcommand. The wire protocol is the standard
 * Agent Client Protocol (https://agentclientprotocol.com), so the bulk of
 * the work lives in `acp/base.ts` shared with Grok Build. This file is
 * the Cursor-specific subclass + provider entry: CLI path resolution,
 * the `authenticate({methodId: "cursor_login"})` step between `initialize`
 * and `session/new`, the `cursor/*` and `session_info_update` extension
 * drop, the `tool_call.<kind>ToolCall` wrapper unwrap (Cursor nests every
 * tool call under a per-tool variant key like `shellToolCall` /
 * `writeToolCall` / `readToolCall` / `createPlanToolCall`), and the
 * headless `cursor-agent -p` path used by `complete()`.
 *
 * Design decisions specific to Cursor (the shared ACP decisions live at
 * the top of `acp/base.ts`):
 *
 *   • Authentication relies on the user's existing `cursor-agent login` —
 *     credentials live in the macOS Keychain (`cursor-access-token` /
 *     `cursor-refresh-token` under account `cursor-user`) and the
 *     Cursor subscription billing is used. We never touch
 *     `CURSOR_API_KEY` (token-billed, would bypass subscription) or
 *     override `HOME` (which detaches Keychain lookup).
 *
 *   • Reasoning level is encoded into the model id itself (Cursor has
 *     no `--effort` flag). `gpt-5.3-codex` → `gpt-5.3-codex-high` when
 *     the caller passes `reasoningLevel: 4`. See `applyCursorReasoning`
 *     in `reasoning-level.ts`.
 *
 *   • `tool_call.<kind>ToolCall` unwrap. Cursor wraps every tool
 *     invocation under a per-tool variant key. We surface the variant
 *     name (`shell`, `write`, `read`, `createPlan`, future additions) as
 *     the canonical tool name and unpack `args` / `result` payloads.
 *     `result` is preserved under `data.toolCallResult` so consumers
 *     wanting the structured success/rejected shape have it.
 *
 *   • MCP injection mirrors the Grok pattern but writes to
 *     `<cwd>/.cursor/mcp.json` (JSON) instead of
 *     `<cwd>/.grok/config.toml` (TOML). Cursor's ACP reads project-scoped
 *     `mcp.json` at startup, so the on-disk channel works the same way.
 *     Stdio MCP entries are bridged to HTTP through
 *     `core/mcp/stdio-http-bridge.ts` (shared with Grok) — Cursor's ACP
 *     advertises only `{http,sse}` in `initialize.mcpCapabilities`, same
 *     as Grok, so the bridge is mandatory for stdio. We merge with any
 *     pre-existing user `mcp.json` and restore it on exit.
 */

import { spawn, execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { bridgeStdioMcpToHttp, type BridgeHandle } from "../mcp/stdio-http-bridge.js";
import type {
  AgentProvider,
  AgentProcess,
  AgentEvent,
  SpawnOptions,
  CompleteOptions,
  CompletionResult,
  ListModelsConfig,
  ListModelsResult,
  RuntimeModelInfo,
} from "./types.js";
import { logger } from "../../lib/logger.js";
import { applyCursorReasoning } from "./reasoning-level.js";
import {
  AcpStdioProcess,
  type AcpSpawnDescriptor,
  type AcpSessionUpdate,
  type UnwrappedToolCall,
} from "./acp/base.js";

// ── CLI discovery ────────────────────────────────────────────────────────────

export const DEFAULT_CURSOR_COMMAND = "cursor-agent";

interface ResolveCursorPathOptions {
  env?: NodeJS.ProcessEnv;
  candidates?: string[];
  isExecutable?: (filePath: string) => boolean;
}

/**
 * Resolve the path to the `cursor-agent` CLI (Cursor's headless binary).
 * Env override → static common locations → PATH lookup.
 */
export function resolveCursorPath(_cwd: string = process.cwd(), opts: ResolveCursorPathOptions = {}): string {
  const env = opts.env ?? process.env;
  if (env.SNA_CURSOR_COMMAND) return env.SNA_CURSOR_COMMAND;
  const home = env.HOME ?? "";
  const candidates = opts.candidates ?? [
    `${home}/.local/bin/cursor-agent`,
    "/usr/local/bin/cursor-agent",
    "/opt/homebrew/bin/cursor-agent",
  ];
  const isExecutable = opts.isExecutable ?? ((filePath: string) => {
    try {
      execSync(`test -x "${filePath}"`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  });
  for (const p of candidates) {
    if (isExecutable(p)) return p;
  }
  return DEFAULT_CURSOR_COMMAND;
}

// ── Cursor tool_call wrapper variants ───────────────────────────────────────

/**
 * Cursor nests every tool invocation under a per-tool variant key inside
 * `tool_call.rawInput` (e.g. `{shellToolCall: {args: {...}, result?: {...}}}`).
 * We surface the variant name (without the trailing "ToolCall") as the
 * canonical tool name and the inner `args` as the input. The `result`
 * (success/rejected) — when present on a `tool_call_update` — is preserved
 * under `data.toolCallResult` so consumers wanting the structured shape
 * can read it without re-parsing.
 */
function unwrapCursorVariant(rawInput: unknown): { variant: string; args: unknown; result?: unknown } | null {
  if (!rawInput || typeof rawInput !== "object") return null;
  const obj = rawInput as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (!key.endsWith("ToolCall") || !value || typeof value !== "object") continue;
    const variant = key.slice(0, -"ToolCall".length);
    const inner = value as { args?: unknown; result?: unknown };
    return { variant, args: inner.args, result: inner.result };
  }
  return null;
}

// ── Process ─────────────────────────────────────────────────────────────────

export class CursorProcess extends AcpStdioProcess {
  /**
   * stdio→HTTP MCP bridges spun up for this session. Each one owns its
   * own child process + listener; disposed on cursor exit so we don't
   * leak sockets between sessions.
   */
  private mcpBridges: BridgeHandle[] = [];
  /**
   * Path to the `<cwd>/.cursor/mcp.json` we touched so cleanup can
   * restore it. `original` is the file's pre-write contents (`null` if
   * we created it from scratch — cleanup then deletes it instead of
   * restoring). `cwd` is recorded so we know whether to remove the
   * `.cursor` directory too (only if we created it).
   */
  private cursorMcpRestore: { path: string; original: string | null; createdDir: boolean } | null = null;

  protected get name(): string { return "cursor"; }

  /**
   * Drop `cursor/*` extension notifications (`cursor/ask_question`,
   * `cursor/create_plan`, `cursor/update_todos`, `cursor/task`,
   * `cursor/generate_image`). They're useful for native IDE clients
   * (Zed, JetBrains) but aren't part of SNA's normalized event model.
   */
  protected get vendorNotificationPrefix(): string { return "cursor/"; }

  protected resolveSpawn(options: SpawnOptions): AcpSpawnDescriptor {
    // `cursor-agent acp` is the only subcommand for ACP mode. Unlike Grok, Cursor
    // doesn't accept top-level model/effort/permission flags on this path —
    // reasoning is encoded into the model id itself (composed by the
    // caller via applyCursorReasoning), and permissions are negotiated
    // through ACP `session/request_permission` regardless of CLI flags.
    const args = ["acp"];
    return { command: resolveCursorPath(options.cwd), args };
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
   * Cursor requires an explicit `authenticate({methodId: "cursor_login"})`
   * step between `initialize` and `session/new`. The actual credential
   * comes from the macOS Keychain (populated by `cursor-agent login`); we never
   * pass it inline — that would force per-token billing rather than the
   * user's Cursor subscription.
   */
  protected async authenticate(_options: SpawnOptions, _initResult: unknown): Promise<void> {
    try {
      await this.request("authenticate", { methodId: "cursor_login" });
    } catch (err) {
      // If the user is already authenticated, Cursor returns an error like
      // "already authenticated". That's not fatal — session/new will work.
      // Anything else, surface as a real failure so the consumer knows
      // they need to run `cursor-agent login`.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already authenticated|already logged in/i.test(msg)) {
        throw err;
      }
    }
  }

  /**
   * Translate Cursor's `cursor/`-prefixed `session/update` sub-types and
   * the proprietary `session_info_update` notification. Returns
   * `undefined` to fall through to base behavior for anything we don't
   * recognise, `null` to silently drop, or an AgentEvent to emit.
   */
  protected translateVendorUpdate(update: AcpSessionUpdate): AgentEvent | null | undefined {
    switch (update.sessionUpdate) {
      case "session_info_update":
        // Cursor-specific session metadata refresh (model name, capability
        // changes, etc.). Not part of SNA's event vocabulary; drop.
        return null;
      default:
        return undefined;
    }
  }

  /**
   * Canonical tool name for a Cursor ACP `tool_call` / `tool_call_update`.
   *
   * Cursor's ACP wire format flattens what its stream-json output expresses
   * as `{<kind>ToolCall: {args, result}}` — over ACP, you get a top-level
   * `update.kind` (e.g. "execute", "read", "edit") plus `update.rawInput`
   * carrying the inner args directly. So we use `kind` as the canonical
   * tool name, and surface `update.title` (the user-visible call
   * description, often the literal shell command in backticks) as
   * `data.cursorTitle` for debug overlays.
   *
   * If a future Cursor version starts shipping the wrapped variant in ACP
   * rawInput, `unwrapCursorVariant` catches it and uses the variant name
   * instead — same path, just slightly nicer name.
   */
  protected unwrapToolCall(update: AcpSessionUpdate): UnwrappedToolCall {
    const wrapped = unwrapCursorVariant(update.rawInput);
    if (wrapped) {
      return {
        toolName: wrapped.variant,
        input: wrapped.args,
        extra: {
          ...(update.title ? { cursorTitle: update.title } : {}),
          ...(wrapped.result !== undefined ? { toolCallResult: wrapped.result } : {}),
        },
      };
    }
    // Flattened ACP shape: prefer `kind` over the title (which often
    // contains the literal command text and isn't a stable tool name).
    const toolName = update.kind || update.title || "tool";
    return {
      toolName,
      input: update.rawInput,
      extra: update.title && update.title !== toolName ? { cursorTitle: update.title } : undefined,
    };
  }

  /**
   * Spin up HTTP bridges for each stdio MCP entry and merge them into
   * `<cwd>/.cursor/mcp.json`. We write the project-scoped file (not
   * `~/.cursor/mcp.json`) so concurrent SNA sessions in different cwds
   * never fight over the same file, and so we don't touch user-global
   * state. Pre-existing user entries are preserved across the SNA write
   * and restored on exit.
   *
   * Entries already declared as `{type:"http",url:...}` are passed
   * through verbatim — no bridge needed. Other unsupported shapes
   * are dropped with a log.
   */
  private async setupMcpBridges(options: SpawnOptions): Promise<void> {
    if (!options.mcpServers) return;

    // Cursor's mcp.json schema for an HTTP server:
    //   { "mcpServers": { "<name>": { "url": "...", "headers": {...} } } }
    type HttpEntry = { url: string; headers?: Record<string, string> };
    const entries: Record<string, HttpEntry> = {};

    for (const [name, cfg] of Object.entries(options.mcpServers)) {
      if (!cfg || typeof cfg !== "object") continue;
      if ("type" in cfg && cfg.type === "http") {
        const entry: HttpEntry = { url: cfg.url };
        if (cfg.headers) entry.headers = cfg.headers;
        entries[name] = entry;
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
        entries[name] = { url: handle.url };
        continue;
      }
      logger.log("agent", `cursor: skipping mcp server '${name}' — unsupported shape`);
    }

    if (Object.keys(entries).length === 0) return;

    const cfgDir = path.join(options.cwd, ".cursor");
    const cfgPath = path.join(cfgDir, "mcp.json");
    let original: string | null = null;
    let createdDir = false;
    try {
      original = fs.readFileSync(cfgPath, "utf-8");
    } catch {
      // No mcp.json yet — also remember whether `.cursor/` itself exists,
      // so cleanup can remove it if we created it. (Prefer not to leave
      // a stray directory in the user's project root.)
      try { fs.accessSync(cfgDir); } catch { createdDir = true; }
    }
    try { fs.mkdirSync(cfgDir, { recursive: true }); } catch {}

    // Merge: existing user entries first, then SNA entries (SNA wins on
    // name collision, which matches the intent — if the consumer asked
    // SNA to expose an MCP named `foo`, that's the one the agent should
    // see for this session). Unknown top-level keys in the user file are
    // preserved as-is.
    let merged: Record<string, unknown>;
    try {
      const parsed = original ? JSON.parse(original) : {};
      merged = (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        ? { ...parsed as Record<string, unknown> }
        : {};
    } catch {
      // Malformed user file — log and start fresh so we don't lose the
      // SNA wiring. Original is preserved in `cursorMcpRestore`, so
      // exit restoration will put the broken file back exactly as it was.
      logger.log("agent", `cursor: existing ${cfgPath} is not valid JSON; not merging`);
      merged = {};
    }
    const existingServers = (merged.mcpServers && typeof merged.mcpServers === "object")
      ? merged.mcpServers as Record<string, unknown>
      : {};
    merged.mcpServers = { ...existingServers, ...entries };

    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2) + "\n");
    this.cursorMcpRestore = { path: cfgPath, original, createdDir };
    logger.log("agent", `cursor: wrote ${Object.keys(entries).length} mcpServers entries to ${cfgPath}`);
  }

  private disposeMcpBridges(): void {
    for (const b of this.mcpBridges) {
      try { b.dispose(); } catch {}
    }
    this.mcpBridges = [];

    const restore = this.cursorMcpRestore;
    this.cursorMcpRestore = null;
    if (!restore) return;
    try {
      if (restore.original === null) {
        fs.unlinkSync(restore.path);
        if (restore.createdDir) {
          // Best-effort: only remove the directory if it's empty (the
          // user might have added other files there in the meantime).
          try { fs.rmdirSync(path.dirname(restore.path)); } catch { /* not empty */ }
        }
      } else {
        fs.writeFileSync(restore.path, restore.original);
      }
    } catch (err) {
      logger.log("agent", `cursor: failed to restore ${restore.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export class CursorProvider implements AgentProvider {
  readonly name = "cursor";
  readonly supportsRuntimePooling = false;

  async isAvailable(): Promise<boolean> {
    try {
      const p = resolveCursorPath(process.cwd());
      execSync(`"${p}" --version`, { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  spawn(options: SpawnOptions): AgentProcess {
    const effectiveModel = applyCursorReasoning(options.model, options.reasoningLevel);
    logger.log(
      "agent",
      `cursor: spawn cwd=${options.cwd} model=${effectiveModel ?? "default"}`,
    );
    // Replace the model id on the way through so CursorProcess sees the
    // effort-resolved variant. We don't mutate the caller's options.
    return new CursorProcess({ ...options, model: effectiveModel });
  }

  async complete(options: CompleteOptions): Promise<CompletionResult> {
    // One-shot path uses `cursor-agent -p` headless mode (stream-json or json),
    // not ACP. The wire format is Anthropic-shape so we mostly mirror
    // Claude Code's complete() — including the streaming-json delta
    // shape (`{type:"assistant",message:{content:[{type:"text",text}]}}`).
    const cursorPath = resolveCursorPath(options.cwd);
    const cwd = options.cwd ?? process.cwd();

    const streaming = typeof options.onDelta === "function";
    const args: string[] = [
      "-p",
      ...(streaming ? ["--output-format", "stream-json", "--stream-partial-output"] : ["--output-format", "json"]),
      "--trust",
      "--force",
    ];
    const baseModel = options.model;
    const effectiveModel = applyCursorReasoning(baseModel, options.reasoningLevel) ?? baseModel;
    if (effectiveModel) args.push("--model", effectiveModel);
    if (options.extraArgs) args.push(...options.extraArgs);
    args.push(options.prompt);

    const timeout = options.timeout ?? 60_000;
    const reportedModel = effectiveModel ?? "auto";

    logger.log(
      "agent",
      `complete: provider=cursor model=${reportedModel} prompt="${options.prompt.slice(0, 60)}..."`,
    );

    return new Promise<CompletionResult>((resolve, reject) => {
      const start = Date.now();
      const proc = spawn(cursorPath, args, {
        cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let streamBuf = "";
      // Track which assistant message ids have already streamed their text
      // so we don't fire onDelta twice when Cursor sends both an incremental
      // chunk (without model_call_id) and a final aggregated message.
      const seenAssistantText = new Set<string>();

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`cursor complete timed out after ${timeout}ms`));
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
            const evt = JSON.parse(t) as {
              type?: string;
              message?: { content?: Array<{ type?: string; text?: string }> };
              timestamp_ms?: number;
              model_call_id?: string;
            };
            if (
              evt.type === "assistant" &&
              typeof evt.timestamp_ms === "number" &&
              !evt.model_call_id &&
              options.onDelta
            ) {
              const blocks = evt.message?.content ?? [];
              for (const block of blocks) {
                if (block?.type === "text" && typeof block.text === "string") {
                  try {
                    options.onDelta(block.text);
                  } catch (cbErr) {
                    clearTimeout(timer);
                    proc.kill();
                    reject(cbErr instanceof Error ? cbErr : new Error(String(cbErr)));
                    return;
                  }
                }
              }
            } else if (evt.type === "assistant" && evt.model_call_id) {
              seenAssistantText.add(evt.model_call_id);
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
          reject(new Error(`cursor exited with code ${code}: ${stderrTail || "(no stderr)"}`));
          return;
        }

        let resultText = "";
        let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
        try {
          if (streaming) {
            // Find the terminal `result` event — it carries the final
            // aggregated text + usage.
            const lines = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
            for (const line of lines) {
              const evt = JSON.parse(line) as {
                type?: string;
                subtype?: string;
                result?: string;
                usage?: {
                  inputTokens?: number;
                  outputTokens?: number;
                  cacheReadTokens?: number;
                  cacheWriteTokens?: number;
                };
              };
              if (evt.type === "result" && evt.subtype === "success") {
                resultText = evt.result ?? "";
                usage = {
                  inputTokens: evt.usage?.inputTokens ?? 0,
                  outputTokens: evt.usage?.outputTokens ?? 0,
                  cacheReadTokens: evt.usage?.cacheReadTokens ?? 0,
                  cacheCreationTokens: evt.usage?.cacheWriteTokens ?? 0,
                };
                break;
              }
            }
          } else {
            const parsed = JSON.parse(stdout) as {
              result?: string;
              usage?: {
                inputTokens?: number;
                outputTokens?: number;
                cacheReadTokens?: number;
                cacheWriteTokens?: number;
              };
            };
            resultText = parsed.result ?? "";
            usage = {
              inputTokens: parsed.usage?.inputTokens ?? 0,
              outputTokens: parsed.usage?.outputTokens ?? 0,
              cacheReadTokens: parsed.usage?.cacheReadTokens ?? 0,
              cacheCreationTokens: parsed.usage?.cacheWriteTokens ?? 0,
            };
          }
        } catch (err) {
          reject(new Error(`cursor complete: failed to parse stdout: ${err instanceof Error ? err.message : String(err)}`));
          return;
        }

        resolve({
          text: resultText,
          usage,
          costUsd: 0,
          durationMs,
          durationApiMs: durationMs,
          model: reportedModel,
        });
      });
    });
  }

  async listModels(_config?: ListModelsConfig): Promise<ListModelsResult> {
    // Cursor's `cursor-agent models` prints a human-readable list (`<id> - <label>`,
    // newline-separated). No `--json` flag exists today, so we parse the
    // text. On failure, fall back to a hard-coded subset of widely-available
    // ids observed at the time of writing.
    try {
      const cursorPath = resolveCursorPath(process.cwd());
      const raw = execSync(`"${cursorPath}" models`, { encoding: "utf-8", timeout: 5000 });
      const models: RuntimeModelInfo[] = [];
      for (const line of raw.split("\n")) {
        const m = line.match(/^([a-z0-9.-]+)\s+-\s+(.+)$/i);
        if (!m) continue;
        const id = m[1]!;
        const label = m[2]!;
        models.push({
          id,
          label,
          provider: providerForCursorModel(id),
          source: "cli",
        });
      }
      if (models.length === 0) throw new Error("cursor-agent models returned no parseable entries");
      return { models, source: "cli", fetchedAt: Date.now() };
    } catch (err) {
      logger.log(
        "agent",
        `cursor listModels: falling back to static catalog (${err instanceof Error ? err.message : String(err)})`,
      );
      const fallback: RuntimeModelInfo[] = [
        { id: "auto", label: "Auto", provider: "cursor", source: "static" },
        { id: "composer-2.5", label: "Composer 2.5", provider: "cursor", source: "static" },
        { id: "gpt-5.3-codex", label: "Codex 5.3", provider: "openai", source: "static" },
        { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", provider: "anthropic", source: "static" },
      ];
      return {
        models: fallback,
        source: "static",
        fetchedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Map a Cursor model id to its inference backend family for attribution
 * purposes (matches the convention used by other providers' RuntimeModelInfo).
 */
function providerForCursorModel(id: string): string {
  if (id.startsWith("gpt-") || id.includes("codex")) return "openai";
  if (id.startsWith("claude-") || id.startsWith("sonnet-") || id.startsWith("opus-") || id.startsWith("haiku-")) return "anthropic";
  if (id.startsWith("gemini-")) return "google";
  if (id.startsWith("grok-")) return "xai";
  return "cursor";
}
