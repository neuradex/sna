/**
 * OpenCode provider.
 *
 * OpenCode runs as a daemon-style HTTP server (`opencode serve`).
 * @opencode-ai/sdk's `createOpencodeServer` already encapsulates spawning
 * the binary, parsing the "listening on URL" line, and tearing it down,
 * so this provider delegates the daemon lifecycle to the SDK.
 *
 * Lifecycle (pooled, the only supported mode):
 *   prepareRuntime → createOpencodeServer({ hostname, port, timeout })
 *                    or short-circuit to a caller-provided URL
 *   spawn          → createOpencodeClient({ baseUrl }) + new OpenCodeProcess
 *   process        → client.session.create → emit init
 *                    client.event.subscribe → SSE → AgentEvent
 *                    client.session.promptAsync(parts) on send()
 *                    client.session.abort on interrupt()
 *                    client.postSessionIdPermissionsPermissionId on respond
 *                    client.session.delete on closeThread()
 *
 * History injection: OpenCode's prompt API only accepts user-side parts
 * (text/file/agent/subtask) — there is no thread/resume(history=...) like
 * Codex. canonicalToOpenCodeHistoryPrelude serializes prior canonical
 * blocks into a single TextPartInput prelude (+ FilePartInputs for embeds)
 * that is prepended to the first user prompt only.
 */

import { execSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
// Lazy-loaded — the SDK is ESM-only (`@opencode-ai/sdk`'s package.json has
// only an `import` export, no `require` export). Static imports get bundled
// by tsup as `require("@opencode-ai/sdk")` for the CJS launcher entries
// (electron/index.cjs, node/index.cjs), which then fails at runtime in
// consumer apps with "No exports main defined". Dynamic import keeps the
// SDK off the static bundle graph and Node resolves it as ESM at runtime.
import type { OpencodeClient } from "@opencode-ai/sdk";
import type {
  AgentProvider,
  AgentProcess,
  AgentEvent,
  SpawnOptions,
  ContentBlock,
  CompleteOptions,
  CompletionResult,
  McpServerConfig,
  ListModelsConfig,
  ListModelsResult,
  RuntimeModelInfo,
} from "./types.js";
import type { RuntimeConfig, RuntimeHandle } from "./runtime.js";
import {
  canonicalToOpenCodeHistoryPrelude,
  type OpenCodePart,
} from "../../history/opencode.js";
import { logger } from "../../lib/logger.js";

const SHELL = process.env.SHELL || "/bin/zsh";

// ── SDK lazy loader ────────────────────────────────────────────────────────

/**
 * Cache for the dynamically-imported SDK. Populated on first prepareRuntime
 * (or complete) call. spawn() runs synchronously and reads from this cache —
 * it relies on prepareRuntime having loaded the SDK first, which is always
 * true for pooled providers (RuntimePool.prepare always runs before spawn).
 */
let _sdkCache: typeof import("@opencode-ai/sdk") | null = null;

async function loadOpenCodeSdk(): Promise<typeof import("@opencode-ai/sdk")> {
  if (!_sdkCache) {
    _sdkCache = await import("@opencode-ai/sdk");
  }
  return _sdkCache;
}

/** Synchronous accessor for spawn() — throws if SDK hasn't been loaded yet. */
function requireLoadedSdk(): typeof import("@opencode-ai/sdk") {
  if (!_sdkCache) {
    throw new Error(
      "OpenCodeProvider: SDK not loaded. Call prepareRuntime() before spawn().",
    );
  }
  return _sdkCache;
}

// ── Binary resolution ──────────────────────────────────────────────────────

export function validateOpenCodePath(opencodePath: string): { ok: boolean; version?: string } {
  try {
    const dir = path.dirname(opencodePath);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` };
    const out = execSync(`"${opencodePath}" --version`, {
      encoding: "utf8", stdio: "pipe", timeout: 10_000, env,
    }).trim();
    return { ok: true, version: out.split("\n")[0].slice(0, 50) };
  } catch {
    return { ok: false };
  }
}

export function cacheOpenCodePath(opencodePath: string, cacheDir?: string): void {
  const dir = cacheDir ?? path.join(process.cwd(), ".sna");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "opencode-path"), opencodePath);
  } catch { /* best effort */ }
}

export interface OpenCodeResolveResult {
  path: string;
  version?: string;
  source: "env" | "cache" | "static" | "shell" | "fallback";
}

export function resolveOpenCodeCli(opts?: { cacheDir?: string }): OpenCodeResolveResult {
  const cacheDir = opts?.cacheDir;

  if (process.env.SNA_OPENCODE_COMMAND) {
    const v = validateOpenCodePath(process.env.SNA_OPENCODE_COMMAND);
    return { path: process.env.SNA_OPENCODE_COMMAND, version: v.version, source: "env" };
  }

  const cacheFile = cacheDir
    ? path.join(cacheDir, "opencode-path")
    : path.join(process.cwd(), ".sna/opencode-path");
  try {
    const cached = fs.readFileSync(cacheFile, "utf8").trim();
    if (cached) {
      const v = validateOpenCodePath(cached);
      if (v.ok) return { path: cached, version: v.version, source: "cache" };
    }
  } catch { /* no cache */ }

  const staticPaths = [
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
    `${process.env.HOME}/.local/bin/opencode`,
    `${process.env.HOME}/.opencode/bin/opencode`,
  ];
  for (const p of staticPaths) {
    const v = validateOpenCodePath(p);
    if (v.ok) {
      cacheOpenCodePath(p, cacheDir);
      return { path: p, version: v.version, source: "static" };
    }
  }

  try {
    const raw = execSync(`${SHELL} -i -l -c "command -v opencode" 2>/dev/null`, {
      encoding: "utf8", timeout: 5000,
    }).trim();
    if (raw && raw !== "opencode" && raw.startsWith("/")) {
      const v = validateOpenCodePath(raw);
      if (v.ok) {
        cacheOpenCodePath(raw, cacheDir);
        return { path: raw, version: v.version, source: "shell" };
      }
    }
  } catch { /* shell detection failed */ }

  return { path: "opencode", source: "fallback" };
}

// ── Permission mode → OpenCode agent ───────────────────────────────────────

/**
 * Map SNA permissionMode → OpenCode agent name when an unambiguous
 * mapping exists, otherwise return undefined to let OpenCode pick the
 * configured default.
 *
 * OpenCode's agent catalog is user-defined in `opencode.json` — there is
 * no guarantee that "build" or any other name actually exists on a given
 * machine. Passing an unknown agent silently breaks the prompt (the
 * server accepts the request but the model never replies, so session.idle
 * never fires either). To avoid that, we only opt in to "plan" when the
 * SNA caller explicitly asks for plan mode, since that mapping is the
 * one OpenCode itself ships out of the box. Every other SNA mode falls
 * through to the user's default agent unless `providerOptions.agent`
 * forces a specific name.
 *
 * @internal Exported for testing only.
 */
export function toOpenCodeAgent(mode?: string): string | undefined {
  switch (mode) {
    case "plan": return "plan";
    default: return undefined;
  }
}

// ── Model parser ──────────────────────────────────────────────────────────

/**
 * OpenCode model selectors carry both `providerID` (anthropic/openai/...)
 * and `modelID` (e.g. claude-sonnet-4-6). SNA's `model` field is a single
 * slug. Accept "providerID/modelID" or fall back to inferring providerID
 * from a curated list of known prefixes.
 *
 * @internal Exported for testing only.
 */
export function parseOpenCodeModel(
  model: string | undefined,
  fallbackProviderId?: string,
): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash > 0) {
    return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
  }
  // Best-effort inference.
  if (fallbackProviderId) return { providerID: fallbackProviderId, modelID: model };
  if (/^claude/i.test(model)) return { providerID: "anthropic", modelID: model };
  if (/^gpt/i.test(model) || /^o\d/i.test(model)) return { providerID: "openai", modelID: model };
  if (/^gemini/i.test(model)) return { providerID: "google", modelID: model };
  // Unknown — return undefined so OpenCode picks the configured default.
  return undefined;
}

// ── OpenCodeProcess ────────────────────────────────────────────────────────

class OpenCodeProcess implements AgentProcess {
  private emitter = new EventEmitter();
  private _alive = true;
  private _sessionId: string | null = null;
  private _initEmitted = false;
  private _ready = false;
  private _pendingSend: (() => void)[] = [];

  /** History prelude — sent on the first user prompt, then cleared. */
  private _pendingPrelude: OpenCodePart[] | null = null;

  /** Per-turn override applied to the next promptAsync. */
  private _modelOverride: string | null = null;
  /** Per-turn agent override (mapped from SNA permissionMode). */
  private _agentOverride: string | null = null;

  /** Parts that have already emitted their final form (for dedupe). */
  private _finalizedParts = new Set<string>();
  /** Tool calls that have emitted their tool_use start event. */
  private _startedTools = new Set<string>();
  /**
   * Map partID → part type, learned from `message.part.updated` so we can
   * route the type-less `message.part.delta` events (which only carry a
   * `field` of "text"/"reasoning" plus the partID) to the right
   * AgentEvent. This is a wire-format quirk of opencode 1.14: deltas are
   * emitted as a separate top-level event rather than as a `delta`
   * field on the part-updated event the SDK types describe.
   */
  private _partTypes = new Map<string, string>();

  /** Set when a turn is in flight; gates session.idle → complete emission. */
  private _processingTurn = false;

  /** Set when interrupt() is called — drops queued deltas. */
  private _interrupted = false;
  private _interruptedEmitted = false;

  /** Async iteration controller for the SSE subscription. */
  private _eventStreamAbort: AbortController | null = null;

  /** Auto-bypass flag — bypassPermissions mode auto-approves every prompt. */
  private readonly _bypassPermissions: boolean;

  /** FIFO event queue + drain timer (mirrors CodexProcess). */
  private eventQueue: AgentEvent[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly DRAIN_INTERVAL_MS = 15;

  constructor(
    private client: OpencodeClient,
    private options: SpawnOptions,
    private runtimeHandle: RuntimeHandle,
  ) {
    this._bypassPermissions = options.permissionMode === "bypassPermissions";
    this.bootstrapSession();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  private async bootstrapSession(): Promise<void> {
    if (!this._alive) return; // killed before bootstrap could run
    try {
      // Subscribe to events first so we don't miss session.created /
      // server.connected fired during creation.
      this.startEventStream();

      // Resume an existing OpenCode session if requested, otherwise create.
      const resumeId =
        this.options.resumeSessionId
        ?? (this.options.providerOptions?.opencodeSessionId as string | undefined);

      if (resumeId) {
        // Verify the session exists; if not, fall through to create.
        try {
          const got = await this.client.session.get({
            path: { id: resumeId },
            query: { directory: this.options.cwd },
          });
          if (got.data?.id) {
            this._sessionId = got.data.id;
          }
        } catch (err) {
          logger.log("agent", `opencode: resume session ${resumeId} failed (${err}); creating new`);
        }
      }

      if (!this._sessionId) {
        const created = await this.client.session.create({
          body: { title: "sna" },
          query: { directory: this.options.cwd },
        });
        if (created.error || !created.data?.id) {
          throw new Error(`session.create failed: ${JSON.stringify(created.error ?? {})}`);
        }
        this._sessionId = created.data.id;
      }

      // Build prelude from canonical history (consumed on first send only).
      if (this.options.history && this.options.history.length > 0) {
        const sessionEnvId = this.options.env?.SNA_SESSION_ID ?? this._sessionId ?? "default";
        this._pendingPrelude = canonicalToOpenCodeHistoryPrelude(
          this.options.history,
          sessionEnvId,
        );
      }

      this._ready = true;
      if (!this._initEmitted) {
        this._initEmitted = true;
        this.enqueue({
          type: "init",
          message: `OpenCode ready (session=${this._sessionId})`,
          data: {
            sessionId: this._sessionId,
            provider: "opencode",
            pooled: true,
          },
          timestamp: Date.now(),
        });
      }

      // Initial prompt, if any.
      if (this.options.prompt) {
        this.startTurn(this.options.prompt);
      }

      for (const fn of this._pendingSend) fn();
      this._pendingSend = [];
    } catch (err) {
      // Killed mid-bootstrap is not an error — the test harness or app may
      // tear down the runtime handle while session.create is still in flight.
      if (!this._alive) return;
      logger.err("agent", `opencode bootstrap failed:`, err);
      this.enqueue({
        type: "error",
        message: `OpenCode initialization failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
    }
  }

  private async startEventStream(): Promise<void> {
    const ctrl = new AbortController();
    this._eventStreamAbort = ctrl;
    try {
      const result = await this.client.event.subscribe({ signal: ctrl.signal });
      // SDK returns { stream: AsyncGenerator<Event> }. Iterate until exit.
      for await (const ev of result.stream as AsyncGenerator<{ type: string; properties?: any }>) {
        if (!this._alive || ctrl.signal.aborted) break;
        this.handleEvent(ev);
      }
    } catch (err) {
      if (!this._alive || ctrl.signal.aborted) return; // shutting down — expected
      // Network-level aborts surface as DOMException("AbortError") or similar.
      const name = (err as any)?.name;
      if (name === "AbortError" || name === "AbortException") return;
      logger.err("agent", `opencode event stream error:`, err);
      this.enqueue({
        type: "error",
        message: `OpenCode event stream lost: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
    }
  }

  // ── Event normalization ──────────────────────────────────────────────────

  private handleEvent(ev: { type: string; properties?: any }): void {
    const props = ev.properties ?? {};
    // Filter to our session where applicable.
    const eventSessionId = this.extractSessionId(ev.type, props);
    if (eventSessionId && this._sessionId && eventSessionId !== this._sessionId) {
      return;
    }

    switch (ev.type) {
      // ── Lifecycle / metadata — silent ─────────────────────────────────
      case "server.connected":
      case "server.heartbeat":
      case "session.created":
      case "session.updated":
      case "session.deleted":
      case "session.compacted":
      case "session.status":      // busy/idle status flicker, replaced by session.idle below
      case "session.diff":
      case "message.removed":
      case "message.part.removed":
      case "todo.updated":
      case "command.executed":
      case "file.edited":
      case "file.watcher.updated":
      case "vcs.branch.updated":
      case "tui.toast.show":
      case "tui.prompt.append":
      case "tui.command.execute":
      case "lsp.client.diagnostics":
      case "lsp.updated":
      case "installation.updated":
      case "installation.update-available":
      case "server.instance.disposed":
        return;

      case "session.idle": {
        if (!this._processingTurn) return;
        // Skip if we already emitted interrupted from abort response.
        if (this._interruptedEmitted) {
          this._interruptedEmitted = false;
          this._processingTurn = false;
          return;
        }
        this._processingTurn = false;
        this.enqueue({
          type: "complete",
          message: "Done",
          data: { provider: "opencode" },
          timestamp: Date.now(),
        });
        return;
      }

      case "session.error": {
        const errInfo = props.error ?? {};
        this.enqueue({
          type: "error",
          message: errInfo.data?.message ?? errInfo.name ?? "OpenCode session error",
          timestamp: Date.now(),
        });
        return;
      }

      case "message.part.updated": {
        const part = props.part;
        if (!part) return;
        // Track partID → type so the type-less message.part.delta events
        // can route to the right AgentEvent.
        if (part.id && part.type) this._partTypes.set(part.id, part.type);
        // SDK types include an optional `delta` field, but real opencode
        // 1.14 always uses the dedicated `message.part.delta` event for
        // streaming. Pass undefined here so normalizePartUpdated treats
        // every event as a non-delta state update.
        this.normalizePartUpdated(part, undefined);
        return;
      }

      case "message.part.delta": {
        // Token delta from real opencode 1.14. Payload:
        //   { sessionID, messageID, partID, field: "text"|"reasoning", delta }
        const partID: string = props.partID;
        const field: string = props.field ?? "text";
        const delta: string = typeof props.delta === "string" ? props.delta : "";
        if (!delta) return;
        const partType = (partID && this._partTypes.get(partID)) ?? field;
        if (this._interrupted) return;
        if (!this._processingTurn) this._processingTurn = true;
        if (partType === "reasoning" || field === "reasoning") {
          this.enqueue({
            type: "thinking_delta",
            message: delta,
            timestamp: Date.now(),
          });
        } else {
          this.enqueue({
            type: "assistant_delta",
            delta,
            index: 0,
            timestamp: Date.now(),
          });
        }
        return;
      }

      case "message.updated": {
        // Final message metadata — useful for token usage; per-part deltas
        // already produced the assistant text. Skip.
        return;
      }

      case "permission.updated": {
        if (this._bypassPermissions) {
          // Auto-approve without UI round-trip.
          if (props.id) {
            void this.respondToPermissionAsync(props.id, true);
          }
          return;
        }
        this.enqueue({
          type: "permission_needed",
          message: props.title ?? "Permission required",
          data: {
            requestId: props.id,
            toolName: props.type ?? "tool",
            command: props.metadata?.command,
            path: props.metadata?.path,
            messageId: props.messageID,
            callId: props.callID,
          },
          timestamp: Date.now(),
        });
        return;
      }

      case "permission.replied":
        return; // audit log, no UI action

      default:
        // Unhandled events are dropped silently — log at debug level only.
        return;
    }
  }

  private extractSessionId(type: string, props: any): string | undefined {
    // OpenCode's session-scoped events carry sessionID either at top level
    // (session.idle, session.error, todo.updated) or nested in info/part.
    if (props.sessionID) return props.sessionID;
    if (props.info?.sessionID) return props.info.sessionID;
    if (props.info?.id && type.startsWith("session.")) return props.info.id;
    if (props.part?.sessionID) return props.part.sessionID;
    return undefined;
  }

  private normalizePartUpdated(part: any, delta: string | undefined): void {
    const partType: string = part.type;
    const partId: string = part.id;

    if (partType === "text") {
      if (typeof delta === "string" && delta.length > 0) {
        if (!this._processingTurn) this._processingTurn = true;
        if (this._interrupted) return;
        this.enqueue({
          type: "assistant_delta",
          delta,
          index: 0,
          timestamp: Date.now(),
        });
        return;
      }
      // Non-delta update: only emit final assistant once per partId.
      const finalized = part.time?.end != null;
      if (finalized && !this._finalizedParts.has(partId)) {
        this._finalizedParts.add(partId);
        this.enqueue({
          type: "assistant",
          message: part.text ?? "",
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (partType === "reasoning") {
      if (typeof delta === "string" && delta.length > 0) {
        if (this._interrupted) return;
        this.enqueue({
          type: "thinking_delta",
          message: delta,
          timestamp: Date.now(),
        });
        return;
      }
      const finalized = part.time?.end != null;
      if (finalized && !this._finalizedParts.has(partId)) {
        this._finalizedParts.add(partId);
        this.enqueue({
          type: "thinking",
          message: part.text ?? "",
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (partType === "tool") {
      const state = part.state ?? {};
      const status: string = state.status;
      const toolName: string = part.tool ?? "tool";
      const callId: string = part.callID ?? part.id;

      if (status === "running" || status === "pending") {
        if (!this._startedTools.has(callId)) {
          this._startedTools.add(callId);
          if (!this._processingTurn) this._processingTurn = true;
          this.enqueue({
            type: "tool_use",
            message: toolName,
            data: {
              toolName,
              id: callId,
              input: state.input ?? {},
              streaming: true,
            },
            timestamp: Date.now(),
          });
        }
        return;
      }

      if (status === "completed") {
        this.enqueue({
          type: "tool_result",
          message: state.output ?? "",
          data: {
            toolName,
            id: callId,
            title: state.title,
            isError: false,
          },
          timestamp: Date.now(),
        });
        return;
      }

      if (status === "error") {
        this.enqueue({
          type: "tool_result",
          message: state.error ?? "Tool error",
          data: {
            toolName,
            id: callId,
            isError: true,
          },
          timestamp: Date.now(),
        });
        return;
      }
      return;
    }

    // step-start / step-finish / snapshot / patch / agent / retry / compaction
    // — no AgentEvent equivalent. Drop.
  }

  // ── Event queue ──────────────────────────────────────────────────────────

  private enqueue(event: AgentEvent): void {
    if (this._interrupted) {
      if (event.type === "assistant_delta" || event.type === "thinking_delta") return;
      this.emitter.emit("event", event);
      if (event.type === "interrupted" || event.type === "complete") {
        this._interrupted = false;
        this.eventQueue = this.eventQueue.filter(
          (e) => e.type !== "assistant_delta" && e.type !== "thinking_delta",
        );
        this.flushQueue();
      }
      return;
    }
    this.eventQueue.push(event);
    if (!this.drainTimer) {
      this.drainTimer = setInterval(() => this.drainOne(), OpenCodeProcess.DRAIN_INTERVAL_MS);
    }
  }

  private drainOne(): void {
    const ev = this.eventQueue.shift();
    if (ev) this.emitter.emit("event", ev);
    if (this.eventQueue.length === 0 && this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private flushQueue(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    while (this.eventQueue.length > 0) {
      this.emitter.emit("event", this.eventQueue.shift()!);
    }
  }

  // ── Turn management ─────────────────────────────────────────────────────

  private startTurn(input: string | ContentBlock[]): void {
    if (!this._sessionId) return;

    // Convert SNA ContentBlock[] / string → OpenCode parts.
    const userParts: OpenCodePart[] = [];
    if (typeof input === "string") {
      userParts.push({ type: "text", text: input });
    } else {
      for (const b of input) {
        if (b.type === "text") {
          userParts.push({ type: "text", text: b.text });
        } else if (b.type === "image") {
          const src = b.source;
          userParts.push({
            type: "file",
            mime: src.media_type,
            url: `data:${src.media_type};base64,${src.data}`,
          });
        }
      }
    }

    // Prepend pending history prelude on the first turn only.
    const parts: OpenCodePart[] = this._pendingPrelude
      ? [...this._pendingPrelude, ...userParts]
      : userParts;
    this._pendingPrelude = null;

    const model = parseOpenCodeModel(
      this._modelOverride ?? this.options.model,
      this.options.providerOptions?.modelProviderId as string | undefined,
    );
    this._modelOverride = null;

    const agent: string | undefined =
      this._agentOverride
      ?? (this.options.providerOptions?.agent as string | undefined)
      ?? toOpenCodeAgent(this.options.permissionMode);
    this._agentOverride = null;

    // Combined system prompt — opencode treats body.system as a per-turn
    // override of the agent's system. Embedded apps (e.g. Loom) build a
    // full system prompt with identity / tag protocol / tool docs and
    // expect every turn to see it. Pass it on every prompt rather than
    // assume opencode persists it across turns.
    const systemParts = [this.options.systemPrompt, this.options.appendSystemPrompt]
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

    // Tool gating. opencode defaults each tool to enabled, so a strict
    // allowlist would require enumerating every tool to set the rest to
    // false — we don't have a way to do that without a round-trip to
    // /experimental/tool. For now we honor disallowedTools fully and
    // treat allowedTools as best-effort: enable the listed tools (a no-op
    // in practice since they'd be on by default).
    const toolMap: Record<string, boolean> = {};
    if (this.options.disallowedTools?.length) {
      for (const t of this.options.disallowedTools) toolMap[t] = false;
    }
    if (this.options.allowedTools?.length) {
      for (const t of this.options.allowedTools) {
        if (!(t in toolMap)) toolMap[t] = true;
      }
    }
    const tools = Object.keys(toolMap).length > 0 ? toolMap : undefined;

    this._processingTurn = true;
    this._finalizedParts.clear();
    this._startedTools.clear();
    this._partTypes.clear();
    this._interrupted = false;
    this._interruptedEmitted = false;

    void this.client.session.promptAsync({
      path: { id: this._sessionId },
      query: { directory: this.options.cwd },
      body: {
        parts: parts as any,
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
        ...(system ? { system } : {}),
        ...(tools ? { tools } : {}),
      },
    }).then((r: any) => {
      if (r?.error) {
        logger.err("agent", `opencode prompt_async failed: ${JSON.stringify(r.error).slice(0, 300)}`);
        this.enqueue({
          type: "error",
          message: `OpenCode prompt failed: ${r.error?.data?.message ?? r.error?.message ?? "unknown"}`,
          timestamp: Date.now(),
        });
        this._processingTurn = false;
      }
    }).catch((err) => {
      logger.err("agent", "opencode prompt_async threw:", err);
      this.enqueue({
        type: "error",
        message: `OpenCode prompt threw: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
      this._processingTurn = false;
    });
  }

  // ── Public AgentProcess API ─────────────────────────────────────────────

  send(input: string | ContentBlock[]): void {
    if (!this._alive) return;
    if (!this._ready) {
      this._pendingSend.push(() => this.startTurn(input));
      return;
    }
    this.startTurn(input);
  }

  interrupt(): void {
    if (!this._alive || !this._sessionId) return;
    this._interrupted = true;
    void this.client.session.abort({
      path: { id: this._sessionId },
      query: { directory: this.options.cwd },
    }).then(() => {
      this._interruptedEmitted = true;
      this.enqueue({
        type: "interrupted",
        message: "Turn interrupted by user",
        data: { provider: "opencode" },
        timestamp: Date.now(),
      });
    }).catch((err) => {
      logger.err("agent", "opencode session.abort failed:", err);
      this.enqueue({
        type: "interrupted",
        message: "Turn interrupted",
        data: { provider: "opencode" },
        timestamp: Date.now(),
      });
    });
  }

  setModel(model: string): void {
    this._modelOverride = model;
    logger.log("agent", `opencode: model override → ${model} (applied on next turn)`);
  }

  setPermissionMode(mode: string): void {
    this._agentOverride = toOpenCodeAgent(mode) ?? null;
    logger.log("agent", `opencode: agent override → ${this._agentOverride ?? "(default)"} (mode=${mode})`);
  }

  applyPatch(patch: import("./types.js").SessionPatch): import("./types.js").SessionPatch {
    // opencode's `setModel` and `setPermissionMode` apply on the next prompt
    // via per-session overrides. cwd has no in-place surface in the current
    // opencode SDK — leave it for the caller to respawn. See sna#22 for the
    // native-channel investigation we plan to do for in-place coverage.
    const leftover: import("./types.js").SessionPatch = {};
    if (patch.model !== undefined) this.setModel(patch.model);
    if (patch.permissionMode !== undefined) this.setPermissionMode(patch.permissionMode);
    if (patch.cwd !== undefined) leftover.cwd = patch.cwd;
    return leftover;
  }

  respondToPermission(requestId: string, approved: boolean): void {
    void this.respondToPermissionAsync(requestId, approved);
  }

  private async respondToPermissionAsync(requestId: string, approved: boolean): Promise<void> {
    if (!this._sessionId) return;
    const response = approved ? "once" : "reject";
    try {
      await this.client.postSessionIdPermissionsPermissionId({
        path: { id: this._sessionId, permissionID: requestId },
        query: { directory: this.options.cwd },
        body: { response },
      });
      logger.log("agent", `opencode: permission ${response} (requestId=${requestId})`);
    } catch (err) {
      logger.err("agent", `opencode permission respond failed:`, err);
    }
  }

  closeThread(): void {
    if (!this._alive) return;
    this._alive = false;
    // Abort the SSE stream first so we don't keep the test process alive.
    try { this._eventStreamAbort?.abort(); } catch { /* ignore */ }
    this._eventStreamAbort = null;
    // Stop the drain timer so process can exit.
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    if (this._sessionId) {
      void this.client.session.delete({
        path: { id: this._sessionId },
        query: { directory: this.options.cwd },
      }).catch(() => { /* daemon may already be down */ });
    }
  }

  kill(): void {
    if (!this._alive) return;
    // Pooled-only — closeThread leaves the daemon alive.
    this.closeThread();
    if (this.runtimeHandle.activeThreadCount > 0) {
      this.runtimeHandle.activeThreadCount--;
    }
  }

  get alive() { return this._alive; }
  get pid() {
    // OpenCode's daemon is shared; thread has no OS pid of its own.
    return null;
  }
  get sessionId() { return this._sessionId; }

  on(event: string, handler: Function): void {
    this.emitter.on(event, handler as any);
  }

  off(event: string, handler: Function): void {
    this.emitter.off(event, handler as any);
  }
}

// ── OpenCodeProvider ──────────────────────────────────────────────────────

export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode";
  readonly supportsRuntimePooling = true;

  async isAvailable(): Promise<boolean> {
    try {
      const r = resolveOpenCodeCli();
      if (r.source === "fallback") return false;
      return r.version != null;
    } catch {
      return false;
    }
  }

  async complete(options: CompleteOptions): Promise<CompletionResult> {
    const cwd = options.cwd ?? process.cwd();
    const externalUrl = options.providerOptions?.serverUrl as string | undefined;

    let serverUrl: string;
    let cleanup: () => void = () => {};

    const sdk = await loadOpenCodeSdk();

    if (externalUrl) {
      // Caller-managed daemon (tests, embedded uses).
      serverUrl = externalUrl;
    } else {
      // Spin up an ephemeral server. Heavier than codex's `exec` one-shot,
      // but honest: there is no `opencode run --json` we can rely on for
      // structured token usage, so we go through the same HTTP API the
      // session path uses.
      const port = await allocateFreePort();
      const server = await sdk.createOpencodeServer({
        hostname: "127.0.0.1",
        port,
        timeout: options.timeout ?? 15_000,
      });
      serverUrl = server.url;
      cleanup = () => { try { server.close(); } catch { /* already gone */ } };
    }

    const client = sdk.createOpencodeClient({ baseUrl: serverUrl });
    const startTime = Date.now();
    const overallTimeout = options.timeout ?? 60_000;

    try {
      const created = await client.session.create({
        body: { title: "sna-complete" },
        query: { directory: cwd },
      });
      if (created.error || !created.data?.id) {
        throw new Error(
          `OpenCode session.create failed: ${JSON.stringify(created.error ?? {})}`,
        );
      }
      const sessionId = created.data.id;

      const model = parseOpenCodeModel(
        options.model,
        options.providerOptions?.modelProviderId as string | undefined,
      );
      const agent = options.providerOptions?.agent as string | undefined;
      const system = [options.systemPrompt, options.appendSystemPrompt]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join("\n\n");

      // Wrap the prompt call in a manual timeout so we don't hang on a
      // network stall — the SDK propagates fetch's signal.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), overallTimeout);

      let result: Awaited<ReturnType<typeof client.session.prompt>>;
      try {
        result = await client.session.prompt({
          path: { id: sessionId },
          query: { directory: cwd },
          signal: ctrl.signal,
          body: {
            parts: [{ type: "text", text: options.prompt }],
            ...(model ? { model } : {}),
            ...(agent ? { agent } : {}),
            ...(system ? { system } : {}),
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if ("error" in result && result.error) {
        throw new Error(
          `OpenCode session.prompt failed: ${JSON.stringify(result.error).slice(0, 300)}`,
        );
      }
      if (!result.data) {
        throw new Error("OpenCode session.prompt returned empty result");
      }
      const info = result.data.info;
      const parts = result.data.parts ?? [];

      // Aggregate text across all text parts. Tool/reasoning parts are
      // dropped — complete() returns a single string by contract.
      let text = "";
      for (const p of parts) {
        if (p.type === "text") text += p.text ?? "";
      }

      const durationMs = Date.now() - startTime;
      const tokens = info.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

      // Best-effort cleanup of the ephemeral session — failures are silent
      // because the daemon is going down anyway.
      void client.session.delete({
        path: { id: sessionId },
        query: { directory: cwd },
      }).catch(() => { /* ignore */ });

      return {
        text,
        usage: {
          inputTokens: tokens.input ?? 0,
          outputTokens: tokens.output ?? 0,
          cacheReadTokens: tokens.cache?.read ?? 0,
          cacheCreationTokens: tokens.cache?.write ?? 0,
        },
        costUsd: info.cost ?? 0,
        durationMs,
        durationApiMs: durationMs,
        model: info.modelID ?? options.model ?? "opencode",
      };
    } finally {
      cleanup();
    }
  }

  async prepareRuntime(config: RuntimeConfig): Promise<RuntimeHandle> {
    // Always load the SDK here so the synchronous spawn() can read it from
    // the cache without doing its own dynamic import. This is necessary even
    // for the serverUrl short-circuit because spawn() still calls
    // sdk.createOpencodeClient.
    await loadOpenCodeSdk();

    // Short-circuit: caller already has a serve URL (tests, external daemons).
    const externalUrl = config.providerOptions?.serverUrl as string | undefined;
    if (externalUrl) {
      logger.log("agent", `opencode: using external serve URL ${externalUrl}`);
      return {
        provider: this.name,
        ready: true,
        activeThreadCount: 0,
        httpUrl: externalUrl,
        dispose: () => { /* caller-owned daemon */ },
      };
    }

    // Allocate a free port. opencode 1.14.33 was reported to mishandle
    // `--port 0`, so we pick the port in Node and pass it explicitly.
    const port = await allocateFreePort();
    const logLevel = (config.providerOptions?.logLevel as string | undefined);
    const opencodeConfig: Record<string, unknown> = {};
    if (logLevel) opencodeConfig.logLevel = logLevel;

    const mcpServers = config.mcp as Record<string, McpServerConfig> | undefined;
    const mcp = mcpServers ? snaMcpToOpenCode(mcpServers) : undefined;
    if (mcp) {
      opencodeConfig.mcp = mcp;
      logger.log("agent", `opencode: registering ${Object.keys(mcp).length} MCP server(s) with daemon`);
    }

    const sdk = await loadOpenCodeSdk();
    const server = await sdk.createOpencodeServer({
      hostname: "127.0.0.1",
      port,
      timeout: 15_000,
      config: opencodeConfig as any,
    });

    logger.log("agent", `opencode: runtime daemon ready (${server.url})`);

    const handle: RuntimeHandle = {
      provider: this.name,
      ready: true,
      activeThreadCount: 0,
      httpUrl: server.url,
      dispose: () => {
        // The SDK's server.close() calls proc.kill() on the cross-spawn
        // handle, but `opencode serve` daemonizes itself (PPID=1 after
        // launch on macOS) — the wrapper's SIGTERM goes nowhere and the
        // daemon stays bound to the port, blocking the next prepareRuntime.
        // Match by --port=N and SIGKILL synchronously so the next call
        // gets a clean port slot.
        try { server.close(); } catch { /* already gone */ }
        try {
          // BSD pkill doesn't honor \b — match the literal end-of-flag
          // by anchoring on the SDK's exact format `--port=N` followed
          // by either a space, end-of-line, or `--hostname` etc.
          // A loose `pgrep -f "--port=${port}"` works in practice because
          // ports are unique to the daemon we just spawned.
          execSync(
            `pkill -9 -f "opencode serve.*--port=${port}( |$)" 2>/dev/null || pkill -9 -f "opencode serve --hostname=127.0.0.1 --port=${port}" 2>/dev/null || true`,
            { stdio: "ignore", shell: "/bin/sh" } as any,
          );
        } catch { /* already gone or nothing matched */ }
      },
    };
    return handle;
  }

  spawn(options: SpawnOptions, runtimeHandle?: RuntimeHandle): AgentProcess {
    if (!runtimeHandle?.httpUrl) {
      throw new Error(
        "OpenCodeProvider.spawn() requires a pooled runtime handle with httpUrl. "
        + "Call prepareRuntime() first.",
      );
    }
    // SDK was loaded by prepareRuntime; spawn is sync so we can't await here.
    const sdk = requireLoadedSdk();
    const client = sdk.createOpencodeClient({ baseUrl: runtimeHandle.httpUrl });
    runtimeHandle.activeThreadCount++;
    return new OpenCodeProcess(client, options, runtimeHandle);
  }

  /**
   * List models available to opencode. Calls `opencode models` (one-shot CLI)
   * which prints `provider/model` per line — its own models.dev cache and any
   * provider keys configured in opencode.json determine what surfaces here.
   *
   * Cached for 5 minutes to keep the settings-page open cheap. Pass
   * `config.refresh: true` after the user edits their opencode.json.
   */
  async listModels(config?: ListModelsConfig): Promise<ListModelsResult> {
    return listOpenCodeModels(config?.cliPath, config?.refresh);
  }
}

// ── opencode model listing (CLI parse + cache) ───────────────────────────────

interface OpenCodeCacheEntry {
  result: ListModelsResult;
  expiresAt: number;
}

const OPENCODE_CACHE_TTL_MS = 5 * 60_000;
const opencodeCache = new Map<string, OpenCodeCacheEntry>();

async function listOpenCodeModels(
  cliPathOverride: string | undefined,
  refresh: boolean | undefined,
): Promise<ListModelsResult> {
  const now = Date.now();
  const cliPath = cliPathOverride ?? (() => {
    try {
      const r = resolveOpenCodeCli();
      return r.source === "fallback" ? null : r.path;
    } catch {
      return null;
    }
  })();

  if (!cliPath) {
    return {
      models: [],
      source: "cli",
      fetchedAt: now,
      error: "opencode CLI not found",
    };
  }

  const cacheKey = cliPath;
  if (!refresh) {
    const cached = opencodeCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.result;
  }

  try {
    const dir = path.dirname(cliPath);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` };
    const stdout = execSync(`"${cliPath}" models`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      env,
    });
    const models = parseOpenCodeModelsOutput(stdout);
    const result: ListModelsResult = { models, source: "cli", fetchedAt: now };
    opencodeCache.set(cacheKey, { result, expiresAt: now + OPENCODE_CACHE_TTL_MS });
    return result;
  } catch (err) {
    return {
      models: [],
      source: "cli",
      fetchedAt: now,
      error: `opencode models failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Parse `opencode models` stdout. Each non-empty line is `<providerId>/<modelId>`.
 * Returns one RuntimeModelInfo per line, with the compound `provider/model` as
 * the spawn slug (matches what spawn() ultimately passes to OpenCode).
 *
 * @internal Exported for testing.
 */
export function parseOpenCodeModelsOutput(stdout: string): RuntimeModelInfo[] {
  const out: RuntimeModelInfo[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes("/")) continue;
    const slash = line.indexOf("/");
    const providerId = line.slice(0, slash);
    const modelId = line.slice(slash + 1);
    if (!providerId || !modelId) continue;
    out.push({
      id: line,
      label: line,
      provider: providerId,
      source: "cli",
    });
  }
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Translate SNA's McpServerConfig record into opencode's Config.mcp shape.
 *
 * SNA's stdio entry is `{ command, args, env, cwd? }`; opencode's local
 * entry is `{ type: "local", command: [cmd, ...args], environment }`.
 * SNA's HTTP entry is `{ type: "http", url, headers }`; opencode's remote
 * entry is `{ type: "remote", url, headers }`.
 *
 * `cwd` from the SNA stdio shape has no opencode equivalent and is dropped
 * — callers that need a specific working directory should use a wrapper
 * script.
 *
 * @internal Exported for testing only.
 */
export function snaMcpToOpenCode(
  servers: Record<string, McpServerConfig>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if ("url" in cfg) {
      const remote: Record<string, unknown> = { type: "remote", url: cfg.url };
      if (cfg.headers) remote.headers = cfg.headers;
      out[name] = remote;
    } else {
      const local: Record<string, unknown> = {
        type: "local",
        command: [cfg.command, ...(cfg.args ?? [])],
      };
      if (cfg.env && Object.keys(cfg.env).length > 0) local.environment = cfg.env;
      out[name] = local;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Allocate a free TCP port by briefly binding 0 then closing. */
async function allocateFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("port allocation failed")));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}
