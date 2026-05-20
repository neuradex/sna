/**
 * Grok Build (xAI) provider — ACP-over-stdio adapter.
 *
 * Backed by the Grok Build CLI's `grok agent stdio` subcommand, which
 * implements the Agent Client Protocol (ACP, https://agentclientprotocol.com)
 * as a JSON-RPC 2.0 stream over stdin/stdout. This is the only provider in
 * SNA whose wire protocol is a public standard rather than a vendor-specific
 * schema — which means the adapter is mostly a thin translator between ACP
 * `session/update` notifications and SNA's normalized `AgentEvent`.
 *
 * Note on product naming: throughout this file, `grok` (lowercase) refers
 * to the CLI binary / registry key only. The xAI product itself is "Grok
 * Build" — that's what user-facing documentation should call it, just as
 * "Claude Code" is the product name behind the `claude` binary.
 *
 * Design decisions (validated against Grok Build CLI 0.1.212):
 *
 * 1. NO daemon pooling. `grok agent stdio` is spawned fresh per session,
 *    mirroring Claude Code's stateless model. xAI's storage layer
 *    (chat_history.jsonl + 6 other files in ~/.grok/sessions/) is treated
 *    as a black box; we never read or write it directly.
 *
 * 2. History injection via ACP `resource` blocks (option B). Probing showed
 *    that `session/load` only replays UI events and does NOT restore model
 *    context — the real context lives in xAI-internal chat_history.jsonl
 *    which is regenerated on load. We instead serialise SNA's canonical
 *    history into a single `resource` content block on the first
 *    `session/prompt`, and the embedded context persists across subsequent
 *    turns within the same grok session (verified: turn-2 still remembered
 *    facts injected on turn-1 without re-injection).
 *
 * 3. Permission flow reuses the Codex bidirectional pattern. ACP's
 *    `session/request_permission` is a server-request (has `id`, expects
 *    a response) with an `options[]` array — structurally identical to
 *    Codex's pattern. We map it to SNA's `permission_needed` event and
 *    accept `respondToPermission()` callbacks the same way.
 *
 * 4. `_x.ai/*` extension notifications (fs_notify, mcp/init_progress,
 *    session_notification, etc.) are dropped on the floor. They're useful
 *    for native IDE clients but irrelevant to SNA's normalized event model.
 *
 * 5. Reasoning level uses the same 5-step table as Claude Code (low / low /
 *    medium / high / xhigh / max).
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "node:fs";
import path from "node:path";
import readline from "readline";
import { bridgeStdioMcpToHttp, type BridgeHandle } from "../mcp/stdio-http-bridge.js";
import type {
  AgentProvider,
  AgentProcess,
  AgentEvent,
  SpawnOptions,
  SessionPatch,
  CompleteOptions,
  CompletionResult,
  ContentBlock,
  ListModelsConfig,
  ListModelsResult,
  RuntimeModelInfo,
} from "./types.js";
import type { CanonicalBlock } from "../../history/types.js";
import { logger } from "../../lib/logger.js";
import { toGrokEffort } from "./reasoning-level.js";

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

// ── JSON-RPC types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ── ACP shapes we actually consume ───────────────────────────────────────────

interface AcpSessionUpdate {
  sessionUpdate:
    | "user_message_chunk"
    | "agent_message_chunk"
    | "agent_thought_chunk"
    | "tool_call"
    | "tool_call_update"
    | "available_commands_update"
    | "plan"
    | string;
  content?: { type: "text"; text?: string } | unknown;
  /** Present on tool_call / tool_call_update */
  toolCallId?: string;
  kind?: string;
  title?: string;
  rawInput?: unknown;
  /** Present on tool_call_update result variant. */
  rawOutput?: unknown;
  /** File/path locations the tool touched — surfaces for tool_call_update. */
  locations?: unknown;
  status?: string;
}

interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind: "allow_always" | "allow_once" | "reject_once" | "reject_always";
}

interface AcpPermissionRequest {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    kind?: string;
    title?: string;
    rawInput?: unknown;
  };
  options: AcpPermissionOption[];
}

// ── History → resource transcript ────────────────────────────────────────────

/**
 * Serialize SNA's canonical history into a plain-text transcript that fits
 * inside one ACP `resource` content block. The grok model treats the
 * content as part of its prompt context — see option-B probe results.
 *
 * Format is intentionally human-readable; the model parses it well enough
 * to extract user-stated facts and prior assistant outputs. Tool calls and
 * results are summarized inline; we do not attempt to round-trip them as
 * structured tool_use blocks (grok would have no use for unfinished tool
 * state from a different provider's session).
 */
/**
 * Translate a `tool_call` or input-refresh `tool_call_update` notification
 * into a normalized `tool_use` AgentEvent. Centralizes the `use_tool`
 * unwrap so both code paths land on the same shape:
 *
 *   • `data.toolName` is the canonical tool name consumers match on
 *     (`pinboard_patch`, `board_item_add`, vendor MCP names, etc.). Grok
 *     wraps every external MCP call in its internal `use_tool` dispatch
 *     with the real tool name nested in `rawInput.tool_name` — we surface
 *     it directly so downstream `isToolName(...)` checks behave the same
 *     way they do for claude / codex / opencode.
 *   • `data.input` is what the *tool* sees: the unwrapped `tool_input`
 *     for use_tool dispatches, or the raw input for grok's native tools
 *     (`search_tool`, `run_terminal_command`, `write`, …).
 *   • `data.grokTitle` preserves grok's human-readable dispatch title
 *     ("Write `/tmp/big.html`", "Execute `wc -c /tmp/big.html`") for
 *     debug overlays / tooltips without confusing the canonical name.
 *   • `data.fromUpdate` flags refresh events so consumers can choose to
 *     skip work that already ran on the initial tool_call. Optional —
 *     idempotent-by-id consumers ignore it.
 */
function toolUseFromUpdate(
  update: AcpSessionUpdate,
  now: number,
  opts: { fromUpdate?: boolean } = {},
): AgentEvent {
  const raw = update.rawInput as { tool_name?: string; tool_input?: unknown } | undefined;
  const isUseTool = !!(raw && typeof raw.tool_name === "string");
  const toolName = isUseTool ? raw!.tool_name! : (update.title ?? "tool");
  const input = isUseTool ? raw!.tool_input : update.rawInput;
  return {
    type: "tool_use",
    message: toolName,
    data: {
      id: update.toolCallId,
      toolName,
      kind: update.kind,
      input,
      grokTitle: update.title,
      ...(opts.fromUpdate ? { fromUpdate: true } : {}),
    },
    timestamp: now,
  };
}

export function serializeHistoryForGrok(history: CanonicalBlock[]): string {
  const lines: string[] = [];
  for (const block of history) {
    const actor = block.actor.toUpperCase();
    switch (block.kind) {
      case "text":
        lines.push(`${actor}: ${block.content}`);
        break;
      case "thinking":
        // Skip internal reasoning from prior providers — adds noise without
        // useful context for grok.
        break;
      case "tool_use": {
        const name = (block.meta as { name?: string } | undefined)?.name ?? "tool";
        lines.push(`${actor} (calling ${name}): ${block.content}`);
        break;
      }
      case "tool_result":
        lines.push(`TOOL_RESULT: ${block.content}`);
        break;
      case "status":
      case "error":
        // Status/error metadata is not useful as prior conversation context.
        break;
    }
  }
  return lines.join("\n");
}

// ── Process ─────────────────────────────────────────────────────────────────

export class GrokProcess extends EventEmitter implements AgentProcess {
  // Definite-assignment: populated inside initialize() before the handshake
  // resolves. Consumers always await this.ready before touching state.
  private proc!: ChildProcess;
  private rl!: readline.Interface;
  private _sessionId: string | null = null;
  private _alive = true;
  /**
   * stdio→HTTP MCP bridges spun up for this session. Each one owns its
   * own child process + listener; dispose them on grok exit so we don't
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

  private rpcIdCounter = 0;
  /** Resolvers for outgoing requests, keyed by our own request id. */
  private readonly pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; method: string }
  >();
  /**
   * Open permission requests from grok. Maps SNA's externally-visible
   * requestId (which we expose via the permission_needed AgentEvent) to
   * grok's JSON-RPC request id, so respondToPermission() can route back.
   */
  private readonly pendingPermissions = new Map<string, number>();

  /** Cached history transcript for first-turn injection (option B). */
  private readonly historyTranscript: string | null;
  private firstPromptSent = false;
  /**
   * Per-turn accumulator for `agent_message_chunk` text. ACP has no terminal
   * "final assistant message" notification — the turn ends implicitly when
   * `session/prompt` resolves with a `stopReason`. SNA's persistence layer,
   * however, only writes assistant rows for the `assistant` event (which
   * carries the full message text), not for the streaming `assistant_delta`
   * chunks. So we accumulate chunks here and flush them as a single
   * `assistant` event right before `complete` — otherwise the assistant turn
   * never lands in chat_messages and reload-the-chat wipes the reply.
   */
  private assistantTurnBuffer = "";
  /**
   * Captured permission mode for the duration of this session. Grok's CLI
   * `--always-approve` flag covers built-in tool prompts but does NOT skip
   * the ACP `session/request_permission` round-trip for MCP tool calls —
   * grok always asks the client even in bypass mode. SNA's SessionManager
   * doesn't auto-resolve permissions either (it expects the renderer to do
   * that via a dialog). So a `bypassPermissions` session would hang on
   * every MCP tool call. We handle the auto-approve here in the provider
   * instead, replying `allow-once` to permission requests before they ever
   * leave SNA.
   */
  private readonly permissionMode: string | undefined;
  /** Set true after initialize + session/new succeed. */
  private ready: Promise<void>;

  constructor(options: SpawnOptions) {
    super();
    this.permissionMode = options.permissionMode;
    this.historyTranscript =
      options.history && options.history.length > 0
        ? serializeHistoryForGrok(options.history)
        : null;

    // Bridge setup is async (needs a free port), so we cannot spawn grok
    // synchronously in the constructor — config.toml must already be written
    // before `grok agent stdio` starts reading it. Drive everything through
    // an async initialize chain. Consumers always await this.ready first.
    this.ready = this.initialize(options);
    this.ready.catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: "error", message, timestamp: Date.now() });
    });
  }

  /**
   * One-shot async setup chain:
   *   1. Bridge any stdio MCP entries to HTTP and write their URLs into
   *      `<cwd>/.grok/config.toml` so grok picks them up at startup. ACP's
   *      `session/new.mcpServers` is rejected by grok 0.1.212 for any
   *      non-empty shape, so config.toml is the only working channel today.
   *   2. Spawn `grok agent stdio` and wire stdout/stderr/exit listeners.
   *   3. Run the ACP handshake (initialize + session/new).
   */
  private async initialize(options: SpawnOptions): Promise<void> {
    try {
      await this.setupMcpBridges(options);
      this.spawnGrok(options);
      await this.runHandshake(options);
    } catch (err) {
      // Any failure between bridge setup and a live grok process leaves
      // orphaned bridges + a config.toml we wrote. The proc.exit handler
      // hasn't been registered yet (or won't fire if grok never spawned),
      // so clean up here. Idempotent — fine to also run from exit later.
      this.disposeMcpBridges();
      throw err;
    }
  }

  private spawnGrok(options: SpawnOptions): void {
    const grokPath = resolveGrokPath(options.cwd);
    // grok's top-level flags (`--model`, `--effort`, `--always-approve`) must
    // come BEFORE the `agent stdio` subcommand — the subcommand itself takes
    // no options other than `--help`. Putting them after silently fails with
    // "error: unexpected argument" and the process exits with code 2 before
    // the ACP handshake even starts.
    const args: string[] = [];
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.reasoningLevel !== undefined) {
      args.push("--effort", toGrokEffort(options.reasoningLevel));
    }
    if (options.permissionMode === "bypassPermissions") {
      args.push("--always-approve");
    }
    args.push("agent", "stdio");

    logger.log("agent", `grok: spawning ${grokPath} ${args.join(" ")} (cwd=${options.cwd})`);

    this.proc = spawn(grokPath, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));

    this.proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // grok's stderr emits two distinct shapes:
      //   1. Structured tracing — `"2026-05-20T... ERROR ..."` (uppercase) —
      //      mostly background-worker chatter (telemetry, memory).
      //   2. Clap arg-parse failures — `"error: unexpected argument '--foo'"`
      //      (lowercase) — fatal, immediate exit.
      // Surface both. Matching case-insensitively also catches "Error:" from
      // panics or auth failures that the CLI prints at startup.
      if (/error/i.test(text)) {
        logger.log("agent", `grok stderr: ${text.trim().slice(0, 400)}`);
      }
    });

    this.proc.on("exit", (code) => {
      this._alive = false;
      // Reject any inflight requests so callers don't hang.
      for (const { reject, method } of this.pendingRequests.values()) {
        reject(new Error(`grok process exited (code=${code}) while waiting for ${method}`));
      }
      this.pendingRequests.clear();
      this.disposeMcpBridges();
      this.emit("exit", code);
    });

    this.proc.on("error", (err) => {
      this._alive = false;
      this.emit("error", err);
    });
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

  // ── JSON-RPC primitives ───────────────────────────────────────────────────

  private write(msg: JsonRpcMessage): void {
    if (!this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error("grok stdin closed");
    }
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = ++this.rpcIdCounter;
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        method,
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ── Stream handling ───────────────────────────────────────────────────────

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      logger.log("agent", `grok: non-JSON line dropped: ${trimmed.slice(0, 200)}`);
      return;
    }

    // Response to one of our outgoing requests
    if ("id" in msg && msg.id != null && !("method" in msg)) {
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;
      this.pendingRequests.delete(msg.id);
      const resp = msg as JsonRpcResponse;
      if (resp.error) {
        pending.reject(new Error(`grok ${pending.method} failed: ${resp.error.message}`));
      } else {
        pending.resolve(resp.result);
      }
      return;
    }

    // Server-initiated request (grok asking us for something)
    if ("method" in msg && "id" in msg && msg.id != null) {
      this.handleServerRequest(msg as JsonRpcRequest);
      return;
    }

    // Notification
    if ("method" in msg) {
      this.handleNotification(msg as JsonRpcNotification);
      return;
    }
  }

  private handleServerRequest(req: JsonRpcRequest): void {
    if (req.method === "session/request_permission") {
      const params = req.params as AcpPermissionRequest;
      const requestId = params.toolCall.toolCallId;

      // Bypass-mode shortcut: pick whichever option carries an "allow"
      // intent (or fall back to the first option) and reply immediately,
      // skipping the SessionManager round-trip + UI dialog entirely. This
      // mirrors the contract of `permissionMode: "bypassPermissions"`,
      // which other providers implement by never asking in the first place.
      if (this.permissionMode === "bypassPermissions") {
        const allowOpt =
          params.options.find((o) => o.kind === "allow_always") ??
          params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];
        if (allowOpt) {
          this.write({
            jsonrpc: "2.0",
            id: req.id,
            result: { outcome: { outcome: "selected", optionId: allowOpt.optionId } },
          });
          return;
        }
      }

      // Externally we expose the toolCallId as the requestId — it's stable
      // across the tool's lifecycle and lets callers correlate with the
      // tool_use AgentEvent that triggered the prompt.
      this.pendingPermissions.set(requestId, req.id);
      this.emitEvent({
        type: "permission_needed",
        message: params.toolCall.title,
        data: {
          requestId,
          toolCall: params.toolCall,
          options: params.options,
        },
        timestamp: Date.now(),
      });
      return;
    }

    // We don't speak the rest of the ACP server-request surface (fs reads,
    // terminal control, etc.). Reply with a method-not-found error so grok
    // doesn't hang waiting on us.
    this.write({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `Method not implemented in SNA: ${req.method}` },
    });
  }

  private handleNotification(notif: JsonRpcNotification): void {
    if (notif.method.startsWith("_x.ai/")) {
      // Vendor extension notifications (fs_notify, mcp/init_progress,
      // session_notification, etc.) — design decision (4): drop.
      return;
    }
    if (notif.method === "session/update") {
      const params = notif.params as { sessionId?: string; update?: AcpSessionUpdate };
      if (!params?.update) return;
      const event = this.translateSessionUpdate(params.update);
      if (event) this.emitEvent(event);
      return;
    }
    // Unknown notifications: log and ignore.
    logger.log("agent", `grok: ignored notification ${notif.method}`);
  }

  private translateSessionUpdate(update: AcpSessionUpdate): AgentEvent | null {
    const now = Date.now();
    const text = (update.content as { text?: string } | undefined)?.text ?? "";
    switch (update.sessionUpdate) {
      case "agent_thought_chunk":
        return { type: "thinking_delta", delta: text, timestamp: now };
      case "agent_message_chunk":
        // Accumulate so the final `assistant` event (flushed when
        // session/prompt resolves) carries the full message text for the DB.
        this.assistantTurnBuffer += text;
        return { type: "assistant_delta", delta: text, timestamp: now };
      case "user_message_chunk":
        // Emitted by grok when replaying loaded sessions or echoing our own
        // prompts back. SNA's user_message AgentEvent has the same shape.
        return { type: "user_message", message: text, timestamp: now };
      case "tool_call":
        return toolUseFromUpdate(update, now);
      case "tool_call_update": {
        // `tool_call_update` is overloaded in ACP — grok uses the same
        // notification for two distinct kinds of update:
        //   (a) Input refresh — rawInput grows or finalizes between the
        //       initial `tool_call` and execution. Carries rawInput + kind +
        //       title + (textual) content, NO status. We emit `tool_use`
        //       again with the same id; SNA's persistence + Loom's
        //       message store merge by id so the existing bubble refreshes
        //       in place. xAI's API itself doesn't expose token-level
        //       streaming for tool arguments (it returns the call "in
        //       whole in a single chunk" per their docs), so the
        //       differences between (a) and the original tool_call are
        //       small finalization patches — but we still pass them
        //       through so future grok/ACP additions slot in cleanly.
        //   (b) Result update — has status (in_progress/completed/failed)
        //       and content/rawOutput. We emit `tool_result` with all
        //       fields preserved so consumers see locations, raw output
        //       (parsed), and the textual content side-by-side.
        const hasResultSignal = !!update.status || update.rawOutput !== undefined;
        if (!hasResultSignal && update.rawInput !== undefined) {
          return toolUseFromUpdate(update, now, { fromUpdate: true });
        }
        return {
          type: "tool_result",
          data: {
            id: update.toolCallId,
            status: update.status,
            content: update.content,
            rawOutput: update.rawOutput,
            locations: update.locations,
            kind: update.kind,
            title: update.title || undefined,
          },
          timestamp: now,
        };
      }
      case "available_commands_update":
      case "plan":
        // Slash-command list refresh / plan-mode pane updates aren't part
        // of SNA's event vocabulary; ignore.
        return null;
      default:
        return null;
    }
  }

  private emitEvent(event: AgentEvent): void {
    this.emit("event", event);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  private async runHandshake(options: SpawnOptions): Promise<void> {
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        // We accept fs/terminal capability declarations but don't actually
        // implement those server-request methods (we reject them in
        // handleServerRequest). Declaring true here would invite grok to
        // call us; declare false to keep traffic minimal.
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });

    // MCP server registration goes through `<cwd>/.grok/config.toml`, not
    // session/new — setupMcpBridges() already wrote that file before this
    // handshake runs. ACP's `session/new.mcpServers` field rejects any
    // non-empty shape on grok 0.1.212 (`Invalid params`), even structurally
    // valid http entries, so we keep it empty and let grok read tools off
    // its own config-load path.
    const sessionResp = (await this.request("session/new", {
      cwd: options.cwd,
      mcpServers: [],
    })) as { sessionId?: string } | undefined;

    const sessionId = sessionResp?.sessionId ?? null;
    if (!sessionId) {
      throw new Error("grok session/new returned no sessionId");
    }
    this._sessionId = sessionId;
    this.emitEvent({
      type: "init",
      message: "grok session ready",
      data: { sessionId },
      timestamp: Date.now(),
    });
  }

  // ── AgentProcess surface ──────────────────────────────────────────────────

  send(input: string | ContentBlock[]): void {
    void this.ready
      .then(() => this.sendPrompt(input))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emitEvent({ type: "error", message, timestamp: Date.now() });
      });
  }

  private async sendPrompt(input: string | ContentBlock[]): Promise<void> {
    if (!this._sessionId) {
      throw new Error("grok: send() called before session is ready");
    }

    // Build ACP prompt blocks. Order matters: on the first turn, the
    // history `resource` block precedes the user's actual text so the
    // transcript reads as prior context, not a follow-up.
    const promptBlocks: unknown[] = [];

    if (!this.firstPromptSent && this.historyTranscript) {
      promptBlocks.push({
        type: "resource",
        resource: {
          uri: "sna://prior-conversation.txt",
          mimeType: "text/plain",
          text:
            "The following is our prior conversation, carried over from " +
            "another agent. Continue from where it leaves off.\n\n" +
            this.historyTranscript,
        },
      });
    }

    if (typeof input === "string") {
      promptBlocks.push({ type: "text", text: input });
      this.emitEvent({ type: "user_message", message: input, timestamp: Date.now() });
    } else {
      for (const block of input) {
        if (block.type === "text") {
          promptBlocks.push({ type: "text", text: block.text });
        } else if (block.type === "image") {
          // ACP's image block expects { type: "image", data, mimeType }.
          // Translate SNA's Anthropic-style {source:{type,media_type,data}}
          // shape into that.
          promptBlocks.push({
            type: "image",
            data: block.source.data,
            mimeType: block.source.media_type,
          });
        }
      }
      this.emitEvent({
        type: "user_message",
        data: { blocks: input },
        timestamp: Date.now(),
      });
    }

    this.firstPromptSent = true;

    try {
      const result = (await this.request("session/prompt", {
        sessionId: this._sessionId,
        prompt: promptBlocks,
      })) as { stopReason?: string } | undefined;
      this.flushAssistantTurn();
      this.emitEvent({
        type: "complete",
        data: { stopReason: result?.stopReason ?? null },
        timestamp: Date.now(),
      });
    } catch (err) {
      // Flush whatever text streamed before the failure so a partial turn
      // still lands in chat_messages and the user sees it after reload.
      this.flushAssistantTurn();
      const message = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: "error", message, timestamp: Date.now() });
    }
  }

  /**
   * Emit the accumulated `agent_message_chunk` text as a single terminal
   * `assistant` event so SNA's persistence layer writes a row to
   * chat_messages, then clear the buffer for the next turn. No-op when
   * nothing streamed (tool-only turns, interruptions before any text).
   */
  private flushAssistantTurn(): void {
    const text = this.assistantTurnBuffer;
    this.assistantTurnBuffer = "";
    if (!text) return;
    this.emitEvent({
      type: "assistant",
      message: text,
      timestamp: Date.now(),
    });
  }

  interrupt(): void {
    if (!this._sessionId || !this._alive) return;
    // ACP's `session/cancel` is a notification, not a request — the
    // current session/prompt request resolves with stopReason="cancelled"
    // once grok stops the turn.
    try {
      this.write({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this._sessionId },
      });
      this.emitEvent({ type: "interrupted", timestamp: Date.now() });
    } catch (err) {
      logger.log("agent", `grok: interrupt failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  setModel(_model: string): void {
    // ACP does not expose a runtime model swap. grok currently advertises
    // a single model ("grok-build"), so this is effectively no-op for now.
    // If multiple models appear later, the only path is respawn — exposed
    // via applyPatch().
  }

  setPermissionMode(_mode: string): void {
    // ACP permissionMode is fixed at process startup. Runtime change
    // requires respawn — returned as leftover from applyPatch.
  }

  applyPatch(patch: SessionPatch): SessionPatch {
    // No in-place patching is supported yet — every mutable field requires
    // a respawn. Return the patch unchanged so session-manager handles it.
    return { ...patch };
  }

  respondToPermission(requestId: string, approved: boolean): void {
    const rpcId = this.pendingPermissions.get(requestId);
    if (rpcId == null) {
      logger.log("agent", `grok: respondToPermission called for unknown requestId=${requestId}`);
      return;
    }
    this.pendingPermissions.delete(requestId);
    // Match the option kinds observed in the probe: "allow-once" /
    // "reject-once". (grok also offers "always" variants — exposing those
    // later would require richer respondToPermission semantics.)
    const optionId = approved ? "allow-once" : "reject-once";
    try {
      // ACP RequestPermissionResponse shape: { outcome: <Outcome> }, where the
      // outcome itself uses `outcome` as its discriminator (not `type`).
      //   { outcome: { outcome: "selected", optionId: "allow-once" } }
      //   { outcome: { outcome: "cancelled" } }
      // grok rejects {type:"selected"} with -32603 "failed to deserialize response".
      this.write({
        jsonrpc: "2.0",
        id: rpcId,
        result: { outcome: { outcome: "selected", optionId } },
      });
    } catch (err) {
      logger.log("agent", `grok: permission response failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  kill(): void {
    if (!this._alive) return;
    this._alive = false;
    // kill() may race with initialize() — proc isn't assigned until
    // spawnGrok() runs. If we beat that, just dispose bridges and bail;
    // initialize() will see _alive=false and unwind on its own.
    if (!this.proc) {
      this.disposeMcpBridges();
      return;
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // already dead
    }
    // Hard fallback if grok doesn't exit cleanly within 2s.
    setTimeout(() => {
      try {
        if (this.proc.exitCode == null) this.proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 2000).unref();
  }

  closeThread(): void {
    // Not pooled — same as kill.
    this.kill();
  }

  get alive(): boolean { return this._alive; }
  get pid(): number | null { return this.proc.pid ?? null; }
  get sessionId(): string | null { return this._sessionId; }
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
