/**
 * AcpStdioProcess — shared ACP-over-stdio adapter base.
 *
 * Both Grok Build and Cursor expose Agent Client Protocol (ACP,
 * https://agentclientprotocol.com) servers over stdio. The wire shapes are
 * nearly identical, so this class extracts the common JSON-RPC pump,
 * handshake, event translation, and permission flow. Per-vendor subclasses
 * (`GrokProcess`, `CursorProcess`) override the small set of hooks that
 * differ — spawn args, optional auth step, vendor notification prefix,
 * tool-call wrapper unwrap, and any pre/post-handshake setup.
 *
 * Design decisions captured here (validated end-to-end against grok 0.1.212
 * during the GrokProcess work; verified compatible with `agent acp` 2026.05
 * during the Cursor work):
 *
 * 1. NO daemon pooling. Each `AcpStdioProcess` owns its own child agent
 *    process, mirroring Claude Code's stateless model.
 *
 * 2. Cross-provider history is injected as a single ACP `resource` content
 *    block on the first `session/prompt`. The model treats the embedded
 *    text as prior context; subsequent turns retain it via the agent's
 *    own session storage, so re-injection is not required. (Capabilities
 *    sometimes advertise `embeddedContext: false` but both providers
 *    accept the block in practice — we send it unconditionally.)
 *
 * 3. Permission flow is the Codex bidirectional pattern: ACP's
 *    `session/request_permission` is a server-request whose response shape
 *    is `{outcome:{outcome:"selected",optionId}}` (note the doubled
 *    `outcome` discriminator — `{type:"selected"}` is silently rejected).
 *    When the session is in `bypassPermissions` mode, we auto-reply with
 *    an `allow_*` option and never surface the prompt to SNA's permission
 *    queue. Subclasses can extend `respondToPermission()` semantics by
 *    overriding the option-id selection.
 *
 * 4. Vendor extension notifications (`_x.ai/*` for Grok, `cursor/*` for
 *    Cursor) are dropped on the floor. They're useful for native IDE
 *    clients but irrelevant to SNA's normalized event model. The prefix
 *    each subclass wants to drop is supplied via `vendorNotificationPrefix`.
 *
 * 5. ACP has no terminal "agent message complete" notification — the turn
 *    ends implicitly when `session/prompt` resolves. SNA's persistence
 *    layer only writes assistant rows for the `assistant` event (the full
 *    message), not the streaming `assistant_delta` chunks. So we
 *    accumulate chunks per turn and flush them as a synthetic `assistant`
 *    event right before `complete`, otherwise reload-the-chat wipes every
 *    streamed reply.
 *
 * Subclasses only need to implement `resolveSpawn()` and `name`. The
 * remaining hooks (`authenticate`, `preHandshake`, `onExit`,
 * `unwrapToolCall`, `translateVendorUpdate`, `vendorNotificationPrefix`)
 * have sensible no-op defaults — override only what differs.
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import readline from "readline";
import type {
  AgentProcess,
  AgentEvent,
  SpawnOptions,
  SessionPatch,
  ContentBlock,
} from "../types.js";
import type { CanonicalBlock } from "../../../history/types.js";
import { logger } from "../../../lib/logger.js";

// ── JSON-RPC types ──────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ── ACP shapes we actually consume ──────────────────────────────────────────

export interface AcpSessionUpdate {
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

export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind: "allow_always" | "allow_once" | "reject_once" | "reject_always";
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    kind?: string;
    title?: string;
    rawInput?: unknown;
  };
  options: AcpPermissionOption[];
}

/** Result of unwrapping a tool_call / tool_call_update. */
export interface UnwrappedToolCall {
  /** Canonical tool name consumers match on. */
  toolName: string;
  /** Arguments the tool will actually receive. */
  input: unknown;
  /** Extra fields to merge into the AgentEvent's `data` (e.g. vendor display title). */
  extra?: Record<string, unknown>;
}

// ── Shared history serializer ───────────────────────────────────────────────

/**
 * Default cross-provider history serializer. Each agent treats this as a
 * plain-text transcript embedded in the prompt context. Tool round-trips
 * are summarized inline — we don't attempt to recreate provider-specific
 * tool_use / tool_result blocks across vendors.
 */
export function serializeHistoryForAcp(history: CanonicalBlock[]): string {
  const lines: string[] = [];
  for (const block of history) {
    const actor = block.actor.toUpperCase();
    switch (block.kind) {
      case "text":
        lines.push(`${actor}: ${block.content}`);
        break;
      case "thinking":
        // Skip internal reasoning from prior providers — adds noise without
        // useful context for the next agent.
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

/**
 * Compose a single system-prompt string from the two SpawnOptions fields.
 * `systemPrompt` and `appendSystemPrompt` are treated as concatenation
 * candidates — the override and the append are joined by a blank line.
 * Returns `null` when neither was supplied.
 */
export function buildSystemPromptText(
  systemPrompt: string | undefined,
  appendSystemPrompt: string | undefined,
): string | null {
  const parts: string[] = [];
  if (systemPrompt && systemPrompt.trim().length > 0) parts.push(systemPrompt);
  if (appendSystemPrompt && appendSystemPrompt.trim().length > 0) parts.push(appendSystemPrompt);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

// ── Spawn descriptor returned by subclasses ─────────────────────────────────

export interface AcpSpawnDescriptor {
  /** Absolute path or bare command for the agent binary. */
  command: string;
  /** Args including any subcommand (e.g. `["agent","stdio"]` or `["acp"]`). */
  args: string[];
  /** Optional env overrides merged into `process.env`. */
  env?: Record<string, string | undefined>;
}

// ── Base class ──────────────────────────────────────────────────────────────

export abstract class AcpStdioProcess extends EventEmitter implements AgentProcess {
  // Definite-assignment: populated inside initialize() before the handshake
  // resolves. Consumers always await this.ready before touching state.
  protected proc!: ChildProcess;
  protected rl!: readline.Interface;
  protected _sessionId: string | null = null;
  protected _alive = true;

  protected rpcIdCounter = 0;
  /** Resolvers for outgoing requests, keyed by our own request id. */
  protected readonly pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; method: string }
  >();
  /**
   * Open permission requests from the agent. Maps SNA's externally-visible
   * requestId (which we expose via the permission_needed AgentEvent) to
   * the agent's JSON-RPC request id, so respondToPermission() can route back.
   */
  protected readonly pendingPermissions = new Map<string, number>();

  /** Cached history transcript for first-turn injection. */
  protected readonly historyTranscript: string | null;
  /**
   * Cached system-prompt text for first-turn injection. ACP doesn't have a
   * server-side `--system-prompt` flag for either Grok Build's
   * `agent stdio` or Cursor's `agent acp`, so we fold the instruction
   * into the first `session/prompt` as a high-priority resource block
   * (placed before the optional history block and the user's actual
   * message). Subsequent turns inherit it via the agent's own session
   * state — same persistence model as `historyTranscript`.
   *
   * Combines `SpawnOptions.systemPrompt` (replaces) and
   * `appendSystemPrompt` (additive) into one string. `null` when neither
   * was supplied.
   */
  protected readonly systemPromptText: string | null;
  protected firstPromptSent = false;
  /**
   * Per-turn accumulator for `agent_message_chunk` text. See design
   * decision (5) in the file header.
   */
  protected assistantTurnBuffer = "";
  /** Captured permission mode — see design decision (3). */
  protected readonly permissionMode: string | undefined;
  /** Set true after initialize + (optional authenticate) + session/new succeed. */
  protected ready: Promise<void>;

  // ──── Subclass hooks ────

  /**
   * Logger label used in `${name} stderr:` messages and similar.
   * Match the provider's registry key (e.g. "grok", "cursor").
   */
  protected abstract get name(): string;

  /**
   * The binary + args + env to spawn. Called once per process construction;
   * subclasses can inspect SpawnOptions to compose flags.
   */
  protected abstract resolveSpawn(options: SpawnOptions): AcpSpawnDescriptor;

  /**
   * Notification methods whose `method` starts with this string are dropped.
   * Use the empty string to disable filtering. Examples: `"_x.ai/"` (Grok),
   * `"cursor/"` (Cursor).
   */
  protected get vendorNotificationPrefix(): string {
    return "";
  }

  /**
   * Optional second handshake step after `initialize`. Cursor uses this to
   * call `authenticate({methodId: "cursor_login"})`; Grok skips it.
   */
  protected async authenticate(_options: SpawnOptions, _initResult: unknown): Promise<void> {
    // default no-op
  }

  /**
   * Hook run before the agent process spawns. Subclasses can perform setup
   * that must be visible to the agent at startup — typically MCP bridge
   * setup + writing provider-specific config files. Throwing aborts spawn;
   * `onPreSpawnCleanup()` will run.
   */
  protected async preHandshake(_options: SpawnOptions): Promise<void> {
    // default no-op
  }

  /**
   * Called when the spawned process exits. Subclasses dispose any per-session
   * resources (MCP bridges, restored config files, etc.).
   */
  protected onExit(_code: number | null): void {
    // default no-op
  }

  /**
   * Called when `kill()` runs before the agent process was spawned (e.g.
   * initialize() failed during preHandshake). Default delegates to onExit.
   */
  protected onPreSpawnCleanup(): void {
    this.onExit(null);
  }

  /**
   * Translate a `tool_call` / input-refresh `tool_call_update` payload into
   * the canonical (name, input, extra) triple. Default unwraps no vendor
   * dispatch wrapper — subclasses can intercept (e.g. Grok's `use_tool`
   * dispatch wraps the real tool name in `rawInput.tool_name`).
   */
  protected unwrapToolCall(update: AcpSessionUpdate): UnwrappedToolCall {
    return {
      toolName: update.title ?? "tool",
      input: update.rawInput,
    };
  }

  /**
   * Handle vendor-specific `session/update` sub-types not in the standard
   * ACP set. Return null to drop, an AgentEvent to emit, or undefined to
   * use the base class fallthrough (which drops unknown sub-types).
   */
  protected translateVendorUpdate(_update: AcpSessionUpdate): AgentEvent | null | undefined {
    return undefined;
  }

  /**
   * Permission option ID to use when responding to a `session/request_permission`.
   * Subclasses can override if the agent's option-id namespace differs.
   * Defaults to the canonical ACP option ids used by both Grok and Cursor:
   * `allow-once` / `reject-once`.
   */
  protected pickPermissionOptionId(approved: boolean, _options: AcpPermissionOption[]): string {
    return approved ? "allow-once" : "reject-once";
  }

  /**
   * Override the resource block prepended to the first `session/prompt`.
   * Default builds an ACP `resource` block; subclasses can swap shapes if
   * a future agent advertises a different embedded-context format.
   */
  protected buildHistoryPromptBlock(transcript: string): unknown {
    return {
      type: "resource",
      resource: {
        uri: "sna://prior-conversation.txt",
        mimeType: "text/plain",
        text:
          "The following is our prior conversation, carried over from " +
          "another agent. Continue from where it leaves off.\n\n" +
          transcript,
      },
    };
  }

  /**
   * Override the resource block prepended to the first `session/prompt`
   * for `systemPrompt` / `appendSystemPrompt`. Placed BEFORE the history
   * block so the model reads it as the highest-priority instruction.
   *
   * Both Grok and Cursor accept ACP `resource` blocks in the prompt
   * (verified live during the option-B probe), even when their
   * `promptCapabilities.embeddedContext` flag advertises `false`. The
   * model treats the text as additional context layered on top of the
   * agent's own system prompt — it can shape behavior strongly but
   * cannot literally REPLACE the vendor's base instructions. Authors
   * that need an authoritative override should phrase it that way
   * ("You are NOT X. You are Y. …") rather than relying on
   * cooperative-tone phrasing.
   */
  protected buildSystemPromptBlock(text: string): unknown {
    return {
      type: "resource",
      resource: {
        uri: "sna://system-prompt.txt",
        mimeType: "text/plain",
        text,
      },
    };
  }

  /**
   * `clientCapabilities` advertised in the initialize request. Subclasses
   * can override — Grok declares fs/terminal=false; Cursor matches that.
   */
  protected initializeClientCapabilities(): Record<string, unknown> {
    return {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    };
  }

  /**
   * `session/new` params builder. Default declares an empty `mcpServers`
   * array because both Grok and Cursor today route MCP via on-disk config
   * files, not the ACP field. Subclasses can override if a provider ever
   * starts accepting it via the wire.
   */
  protected sessionNewParams(options: SpawnOptions): Record<string, unknown> {
    return {
      cwd: options.cwd,
      mcpServers: [],
    };
  }

  // ──── Constructor + initialize ────

  constructor(options: SpawnOptions) {
    super();
    this.permissionMode = options.permissionMode;
    this.historyTranscript =
      options.history && options.history.length > 0
        ? this.serializeHistory(options.history)
        : null;
    this.systemPromptText = buildSystemPromptText(
      options.systemPrompt,
      options.appendSystemPrompt,
    );

    this.ready = this.initialize(options);
    this.ready.catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: "error", message, timestamp: Date.now() });
    });
  }

  /**
   * Override to customize history transcript format. Default uses the
   * shared cross-provider serializer.
   */
  protected serializeHistory(history: CanonicalBlock[]): string {
    return serializeHistoryForAcp(history);
  }

  /**
   * One-shot async setup chain:
   *   1. Subclass `preHandshake` (e.g. MCP bridge setup + config write)
   *   2. Spawn agent and wire stdio
   *   3. ACP `initialize` + optional `authenticate` + `session/new`
   */
  private async initialize(options: SpawnOptions): Promise<void> {
    try {
      await this.preHandshake(options);
      this.spawnAgent(options);
      await this.runHandshake(options);
    } catch (err) {
      // Any failure between preHandshake and a live handshake leaves
      // orphaned subclass resources. Trigger cleanup hook before bubbling.
      this.onPreSpawnCleanup();
      throw err;
    }
  }

  private spawnAgent(options: SpawnOptions): void {
    const desc = this.resolveSpawn(options);

    logger.log("agent", `${this.name}: spawning ${desc.command} ${desc.args.join(" ")} (cwd=${options.cwd})`);

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (options.env) Object.assign(env, options.env);
    if (desc.env) {
      for (const [k, v] of Object.entries(desc.env)) {
        if (v !== undefined) env[k] = v;
      }
    }

    this.proc = spawn(desc.command, desc.args, {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));

    this.proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // Surface any line containing "error" (case-insensitive) — catches
      // both vendor tracing "ERROR" chatter and clap-style "error:" parse
      // failures. Cap the snippet so a panic dump doesn't fill the log.
      if (/error/i.test(text)) {
        logger.log("agent", `${this.name} stderr: ${text.trim().slice(0, 400)}`);
      }
    });

    this.proc.on("exit", (code) => {
      this._alive = false;
      for (const { reject, method } of this.pendingRequests.values()) {
        reject(new Error(`${this.name} process exited (code=${code}) while waiting for ${method}`));
      }
      this.pendingRequests.clear();
      this.onExit(code);
      this.emit("exit", code);
    });

    this.proc.on("error", (err) => {
      this._alive = false;
      this.emit("error", err);
    });
  }

  private async runHandshake(options: SpawnOptions): Promise<void> {
    const initResult = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: this.initializeClientCapabilities(),
    });

    await this.authenticate(options, initResult);

    const sessionResp = (await this.request(
      "session/new",
      this.sessionNewParams(options),
    )) as { sessionId?: string } | undefined;

    const sessionId = sessionResp?.sessionId ?? null;
    if (!sessionId) {
      throw new Error(`${this.name}: session/new returned no sessionId`);
    }
    this._sessionId = sessionId;
    this.emitEvent({
      type: "init",
      message: `${this.name} session ready`,
      data: { sessionId },
      timestamp: Date.now(),
    });
  }

  // ──── JSON-RPC primitives ────

  protected write(msg: JsonRpcMessage): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      throw new Error(`${this.name} stdin closed`);
    }
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  protected request<T = unknown>(method: string, params?: unknown): Promise<T> {
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

  // ──── Stream handling ────

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      logger.log("agent", `${this.name}: non-JSON line dropped: ${trimmed.slice(0, 200)}`);
      return;
    }

    // Response to one of our outgoing requests
    if ("id" in msg && msg.id != null && !("method" in msg)) {
      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;
      this.pendingRequests.delete(msg.id);
      const resp = msg as JsonRpcResponse;
      if (resp.error) {
        pending.reject(new Error(`${this.name} ${pending.method} failed: ${resp.error.message}`));
      } else {
        pending.resolve(resp.result);
      }
      return;
    }

    // Server-initiated request (agent asking us for something)
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
    // terminal control, etc.). Reply with a method-not-found error so the
    // agent doesn't hang waiting on us.
    this.write({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `Method not implemented in SNA: ${req.method}` },
    });
  }

  private handleNotification(notif: JsonRpcNotification): void {
    const prefix = this.vendorNotificationPrefix;
    if (prefix && notif.method.startsWith(prefix)) {
      // Vendor extension notification — drop on the floor.
      return;
    }
    if (notif.method === "session/update") {
      const params = notif.params as { sessionId?: string; update?: AcpSessionUpdate };
      if (!params?.update) return;
      const event = this.dispatchSessionUpdate(params.update);
      if (event) this.emitEvent(event);
      return;
    }
    // Unknown notifications: log and ignore.
    logger.log("agent", `${this.name}: ignored notification ${notif.method}`);
  }

  private dispatchSessionUpdate(update: AcpSessionUpdate): AgentEvent | null {
    // Subclass first — lets vendor-specific sub-types short-circuit the
    // default ACP set without monkeying with switch statements.
    const vendor = this.translateVendorUpdate(update);
    if (vendor !== undefined) return vendor;

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
        return { type: "user_message", message: text, timestamp: now };
      case "tool_call":
        return this.buildToolUseEvent(update, now, false);
      case "tool_call_update": {
        // ACP overloads `tool_call_update` for two distinct purposes:
        //   (a) Input refresh — rawInput grows or finalizes between the
        //       initial `tool_call` and execution. No status, no rawOutput.
        //       We emit `tool_use` again with the same id so the persistence
        //       layer merges by id.
        //   (b) Result update — has status (in_progress/completed/failed)
        //       and/or rawOutput. We emit `tool_result` with everything.
        const hasResultSignal = !!update.status || update.rawOutput !== undefined;
        if (!hasResultSignal && update.rawInput !== undefined) {
          return this.buildToolUseEvent(update, now, true);
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

  private buildToolUseEvent(update: AcpSessionUpdate, now: number, fromUpdate: boolean): AgentEvent {
    const { toolName, input, extra } = this.unwrapToolCall(update);
    return {
      type: "tool_use",
      message: toolName,
      data: {
        id: update.toolCallId,
        toolName,
        kind: update.kind,
        input,
        ...(extra ?? {}),
        ...(fromUpdate ? { fromUpdate: true } : {}),
      },
      timestamp: now,
    };
  }

  protected emitEvent(event: AgentEvent): void {
    this.emit("event", event);
  }

  // ──── AgentProcess surface ────

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
      throw new Error(`${this.name}: send() called before session is ready`);
    }

    const promptBlocks: unknown[] = [];

    // First-turn injection. Order matters — the model reads top-down,
    // so authority decreases as we go:
    //
    //   1. System prompt    (highest authority — sets identity/policy)
    //   2. History transcript (prior context for cross-provider resume)
    //   3. User text        (the current question)
    //
    // Subsequent turns rely on the agent's own session state — both
    // blocks land in the agent's internal history after turn 1, so
    // re-injection is wasted tokens.
    if (!this.firstPromptSent) {
      if (this.systemPromptText) {
        promptBlocks.push(this.buildSystemPromptBlock(this.systemPromptText));
      }
      if (this.historyTranscript) {
        promptBlocks.push(this.buildHistoryPromptBlock(this.historyTranscript));
      }
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
   * nothing streamed.
   */
  protected flushAssistantTurn(): void {
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
    // once the agent stops the turn.
    try {
      this.write({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this._sessionId },
      });
      this.emitEvent({ type: "interrupted", timestamp: Date.now() });
    } catch (err) {
      logger.log("agent", `${this.name}: interrupt failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  setModel(_model: string): void {
    // ACP does not expose a runtime model swap. Subclasses can override if
    // the underlying CLI grows the surface; the only path today is respawn
    // (returned as leftover from applyPatch).
  }

  setPermissionMode(_mode: string): void {
    // ACP permissionMode is fixed at process startup. Runtime change
    // requires respawn — returned as leftover from applyPatch.
  }

  applyPatch(patch: SessionPatch): SessionPatch {
    // No in-place patching supported in the base implementation — every
    // mutable field requires a respawn. Return the patch unchanged so
    // session-manager handles it.
    return { ...patch };
  }

  respondToPermission(requestId: string, approved: boolean): void {
    const rpcId = this.pendingPermissions.get(requestId);
    if (rpcId == null) {
      logger.log("agent", `${this.name}: respondToPermission called for unknown requestId=${requestId}`);
      return;
    }
    this.pendingPermissions.delete(requestId);
    // ACP RequestPermissionResponse shape: { outcome: <Outcome> }, where the
    // outcome itself uses `outcome` as its discriminator (not `type`).
    //   { outcome: { outcome: "selected", optionId: "allow-once" } }
    //   { outcome: { outcome: "cancelled" } }
    // Sending {type:"selected"} is silently rejected with -32603.
    const optionId = this.pickPermissionOptionId(approved, []);
    try {
      this.write({
        jsonrpc: "2.0",
        id: rpcId,
        result: { outcome: { outcome: "selected", optionId } },
      });
    } catch (err) {
      logger.log("agent", `${this.name}: permission response failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  kill(): void {
    if (!this._alive) return;
    this._alive = false;
    // kill() may race with initialize() — proc isn't assigned until
    // spawnAgent() runs. If we beat that, run the pre-spawn cleanup and
    // bail; initialize() will see _alive=false and unwind on its own.
    if (!this.proc) {
      this.onPreSpawnCleanup();
      return;
    }
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // already dead
    }
    // Hard fallback if the agent doesn't exit cleanly within 2s.
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
  get pid(): number | null { return this.proc?.pid ?? null; }
  get sessionId(): string | null { return this._sessionId; }
}
