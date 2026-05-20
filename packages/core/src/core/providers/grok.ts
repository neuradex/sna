/**
 * Grok (xAI) provider — ACP-over-stdio adapter.
 *
 * Backed by the `grok` CLI's `agent stdio` subcommand, which implements the
 * Agent Client Protocol (ACP, https://agentclientprotocol.com) as a
 * JSON-RPC 2.0 stream over stdin/stdout. This is the only provider in SNA
 * whose wire protocol is a public standard rather than a vendor-specific
 * schema — which means the adapter is mostly a thin translator between ACP
 * `session/update` notifications and SNA's normalized `AgentEvent`.
 *
 * Design decisions (validated against grok 0.1.212):
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
import readline from "readline";
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
  private readonly proc: ChildProcess;
  private readonly rl: readline.Interface;
  private _sessionId: string | null = null;
  private _alive = true;

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
  /** Set true after initialize + session/new succeed. */
  private ready: Promise<void>;

  constructor(options: SpawnOptions) {
    super();
    this.historyTranscript =
      options.history && options.history.length > 0
        ? serializeHistoryForGrok(options.history)
        : null;

    const grokPath = resolveGrokPath(options.cwd);
    const args = ["agent", "stdio"];
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.reasoningLevel !== undefined) {
      args.push("--reasoning-effort", toGrokEffort(options.reasoningLevel));
    }
    if (options.permissionMode === "bypassPermissions") {
      // grok's `--always-approve` is the closest equivalent; not exposed as
      // a permission-mode toggle on `agent stdio`, but the agent subcommand
      // accepts it.
      args.push("--always-approve");
    }

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
      // grok's stderr emits structured `tracing` lines like
      //   "2026-05-20T... ERROR ..." that are mostly background-worker
      // chatter (telemetry, memory). Surface ERROR lines so a real failure
      // isn't silent, but don't promote them to AgentEvent errors.
      if (text.includes("ERROR")) {
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
      this.emit("exit", code);
    });

    this.proc.on("error", (err) => {
      this._alive = false;
      this.emit("error", err);
    });

    this.ready = this.runHandshake(options);
    // Surface handshake failures as AgentEvent errors rather than unhandled
    // promise rejections — the SessionManager only listens on the event/exit
    // channels.
    this.ready.catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: "error", message, timestamp: Date.now() });
    });
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
      // Externally we expose the toolCallId as the requestId — it's stable
      // across the tool's lifecycle and lets callers correlate with the
      // tool_use AgentEvent that triggered the prompt.
      const requestId = params.toolCall.toolCallId;
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
        return { type: "assistant_delta", delta: text, timestamp: now };
      case "user_message_chunk":
        // Emitted by grok when replaying loaded sessions or echoing our own
        // prompts back. SNA's user_message AgentEvent has the same shape.
        return { type: "user_message", message: text, timestamp: now };
      case "tool_call":
        return {
          type: "tool_use",
          message: update.title,
          data: {
            id: update.toolCallId,
            kind: update.kind,
            input: update.rawInput,
          },
          timestamp: now,
        };
      case "tool_call_update":
        // Status updates and final results both arrive here. Surface as
        // tool_result; data.status lets the consumer distinguish "still
        // running" from "completed" if it cares.
        return {
          type: "tool_result",
          data: {
            id: update.toolCallId,
            status: update.status,
            content: update.content,
          },
          timestamp: now,
        };
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

    const sessionResp = (await this.request("session/new", {
      cwd: options.cwd,
      mcpServers: [], // SNA does not currently wire MCP through to grok.
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
      this.emitEvent({
        type: "complete",
        data: { stopReason: result?.stopReason ?? null },
        timestamp: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: "error", message, timestamp: Date.now() });
    }
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
