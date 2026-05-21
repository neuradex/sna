## SNA Architecture

SNA wraps Claude Code, Codex, and OpenCode as backend processes and exposes them through a single HTTP/WebSocket API. Consumer apps treat the running agent like any other backend service: they create a session, send messages, and subscribe to events. They never spawn the CLI directly.

```
Consumer app  ──HTTP──▶  SNA server  ──spawn──▶  claude-code | codex | opencode
              ◀──WS────              ◀──events─
```

### Packages

| Package | npm name | Role |
|---------|----------|------|
| `packages/core`    | `@sna-sdk/core`    | HTTP/WS server, session manager, providers, canonical history, SQLite, launchers |
| `packages/client`  | `@sna-sdk/client`  | Framework-agnostic TS client (HTTP + WS) |
| `packages/react`   | `@sna-sdk/react`   | React hooks, components, chat UI, Zustand stores |
| `packages/testing` | `@sna-sdk/testing` | Mock Anthropic API + `sna-test` CLI |

### Server (`@sna-sdk/core`)

`createSnaApp({ sessionManager })` returns a Hono app with the full HTTP API. `attachWebSocket(server, sessionManager)` mounts the WS handler on `/ws`. Most consumers don't call these directly — `startSnaServer()` from `@sna-sdk/core/node` or `@sna-sdk/core/electron` forks `dist/server/standalone.js`, which wires everything up and waits for ready.

### Session manager

Every running agent is a `Session` owned by `SessionManager`. Each session has:

- `process` — the spawned `AgentProcess` (Claude Code, Codex, or OpenCode), or `null` when idle
- `eventBuffer` + `eventCounter` — append-only stream consumed by subscribers via `since`
- `cwd`, `label`, `meta` — metadata persisted to `chat_sessions` so the SDK can be shared across apps. Use `meta.app: "loom"` (for example) to isolate sessions per consumer.
- `config` — `SessionConfig` (`{ provider, modelProvider, model, cwd, permissionMode, providerOptions, ... }`), used by `agent.restart` to bring the same config back. The legacy field name was `lastStartConfig`; the type alias `StartConfig` is kept for one release.
- `state` — `idle` | `processing` | `waiting` | `permission`
- `ccSessionId` — the runtime's own session id, captured from the `init` event so `--resume` works
- `currentRuntimeId` — points at the active `RuntimeSession` in the audit chain (see below)

Every config mutation — `saveStartConfig`, `restartSession`, `setSessionModel`, `setSessionPermissionMode`, `applySessionPatch` — appends a new `RuntimeSession` row to the `runtime_sessions` table and retires the previous one. `Session.config` mirrors the current `RuntimeSession.config` for backward compat with in-process callers. The full chain is available via `getRuntimeChain(sessionId)` and exposed on the HTTP surface as `SessionInfo.runtimeChain` (opt-in via `?include=chain`).

`applySessionPatch(id, patch, respawnFn)` is the unified PATCH mutator: it asks the live `AgentProcess.applyPatch(patch)` first (codex queues per-turn overrides; claude-code emits `set_model` / `set_permission_mode` control_requests) and inspects the leftover. Empty leftover → in-place transition; non-empty → kill + respawn with history replay. Either path appends exactly one chain node and emits `configChanged`.

Listeners cover lifecycle (`started` / `resumed` / `killed` / `exited` / `crashed` / `restarted`), config changes, state changes, agent events, permission requests, and skill events. `SessionManagerOptions.maxSessions` caps the number of concurrently alive subprocesses.

### Providers

`core/providers/{claude-code,codex,opencode}.ts` implement a common `AgentProvider` interface:

```ts
interface AgentProvider {
  readonly name: string;
  readonly supportsRuntimePooling: boolean;
  isAvailable(): Promise<boolean>;
  prepareRuntime?(config: RuntimeConfig): Promise<RuntimeHandle>;
  spawn(options: SpawnOptions, runtimeHandle?: RuntimeHandle): AgentProcess;
  complete(options: CompleteOptions): Promise<CompletionResult>;
}
```

The returned `AgentProcess` exposes a uniform control surface — `send`, `interrupt`, `setModel`, `setPermissionMode`, `respondToPermission`, `closeThread`, `kill` — that each provider translates into its native control message.

Two runtime shapes are supported:

- **Stateless per-session** (Claude Code) — `supportsRuntimePooling = false`. Each session spawns its own subprocess; `prepareRuntime` is unused.
- **Daemon-pooled** (Codex, OpenCode) — `supportsRuntimePooling = true`. `prepareRuntime` starts (or reuses, via `RuntimePool`) a long-lived daemon process; `spawn` allocates a thread/session on top of it. `kill()` calls `closeThread()` to release the thread without tearing down the daemon. `RuntimePool.dispose()` shuts everything down on SNA exit.

For Codex the daemon is `codex app-server` over JSON-RPC stdio. For OpenCode it is `opencode serve` over HTTP/SSE — `OpenCodeProvider` delegates to `@opencode-ai/sdk`'s `createOpencodeServer` for the spawn and uses `createOpencodeClient` for typed HTTP calls (`session.create`, `session.promptAsync`, `session.abort`, `event.subscribe`, `postSessionIdPermissionsPermissionId`).

`SpawnOptions` covers the cross-provider knobs (`cwd`, `prompt`, `model`, `permissionMode`, `systemPrompt`, `appendSystemPrompt`, `allowedTools`, `disallowedTools`, `mcpServers`, `history`, `env`, `configDir`, `resumeSessionId`). Anything provider-specific goes in `providerOptions` (an opaque record). Use `getProvider("claude-code" | "codex" | "opencode")` from `@sna-sdk/core` to look one up.

### Canonical conversation model

`db/schema.ts` stores chat blocks in `chat_messages` with two orthogonal axes:

- `actor`: `user` | `assistant` | `system`
- `kind`: `text` | `thinking` | `tool_use` | `tool_result` | `status` | `error`

Binary attachments live in an `embeds` JSON column keyed by id; content text holds inline `![](embed://<id>)` refs. `meta` carries kind-specific overlays (usage on `status`, `tool_use_id` on `tool_result`, `signature` on `thinking`, etc.).

```sql
chat_sessions (id PK, label, type, meta, cwd, last_start_config, created_at)
chat_messages (id PK, session_id FK, actor, kind, content, embeds, skill_name, meta, created_at, updated_at)
```

`history/canonical.ts` reads these rows back into `CanonicalBlock[]`. Provider adapters in `history/{claude-code,codex,opencode}.ts` convert canonical blocks into the native wire format — Claude JSONL for `--resume`, Codex `thread/resume(history=...)` payload, OpenCode prompt-prelude parts (since OpenCode's prompt API only accepts user-side input parts, prior turns are serialized into a single `TextPartInput` prepended to the first user prompt) — which is what lets a session switch providers (or models) without losing context.

### 3-layer attribution

Every assistant turn is stamped with three identifiers:

| Layer | Field | Examples |
|-------|-------|----------|
| Runtime CLI | `provider` | `claude-code`, `codex`, `opencode` |
| Model vendor | `modelProvider` | `anthropic`, `openai`, `google` |
| Model slug | `model` | `claude-sonnet-4-6`, `gpt-5.4` |

Splitting these matters because the same runtime can talk to multiple model vendors (OpenCode + Anthropic, OpenCode + OpenAI, OpenRouter, ...). Tracing, UI badges, and cost aggregation all key off these three values.

### Event protocol

Fifteen normalized event types flow over the agent stream:

| Type | Meaning |
|------|---------|
| `init` | Session initialized; carries the provider's session id |
| `thinking` | Extended thinking block, complete |
| `thinking_delta` | Streaming thinking chunk |
| `text_delta` | Streaming raw text chunk (pre-finalization) |
| `assistant` | Full assistant message |
| `assistant_delta` | Streaming assistant token chunk |
| `tool_use` | Agent is calling a tool |
| `tool_use_delta` | Streaming tool-input chunk (partial JSON) |
| `tool_result` | Tool returned a result |
| `permission_needed` | Agent paused for approval |
| `milestone` | Skill / app-level progress signal |
| `user_message` | User message sent (multi-client sync) |
| `interrupted` | Current turn was interrupted |
| `error` | Error occurred |
| `complete` | Agent finished |

The `*_delta` variants stream tokens for ChatGPT-style UIs; the non-delta version always fires once the block is complete.

### Transports

#### HTTP

The HTTP routes are defined with `@hono/zod-openapi` in `server/routes/openapi.ts`, so the running server also publishes its own OpenAPI 3.1 spec. See [OpenAPI / Swagger UI](#openapi--swagger-ui) below.

| Method | Path | What it does |
|--------|------|--------------|
| `GET`    | `/health` | Health check |
| `GET`    | `/api/sna-port` | Read the dynamically allocated port from `.sna/sna-api.port` |
| `POST`   | `/agent/sessions` | Create a session |
| `GET`    | `/agent/sessions` | List sessions (pass `?include=chain` for `runtimeChain` on each entry) |
| `PATCH`  | `/agent/sessions/:id` | Update session metadata (label, meta, cwd) |
| `DELETE` | `/agent/sessions/:id` | Remove a session, its history, runtime chain, and pending permission request |
| `POST`   | `/agent/start` | Start (spawn) agent in a session |
| `POST`   | `/agent/send` | Send a message (supports `images[]`) |
| `POST`   | `/agent/resume` | Restart with canonical history rebuilt for the provider |
| `POST`   | `/agent/restart` | Re-spawn with the same `Session.config` (with optional overrides) |
| `PATCH`  | `/agent/session` | Unified PATCH mutator for `{cwd, model, permissionMode}`; in-place where possible, respawn-with-history-replay otherwise |
| `POST`   | `/agent/interrupt` | Interrupt current turn (process stays alive) |
| `POST`   | `/agent/set-model` | Change model at runtime |
| `POST`   | `/agent/set-permission-mode` | Change permission mode at runtime |
| `POST`   | `/agent/kill` | Kill the agent in a session |
| `GET`    | `/agent/status` | Session status snapshot |
| `POST`   | `/agent/run-once` | One-shot: spawn → run → return result → cleanup |
| `POST`   | `/agent/run-once/stream` | One-shot, SSE feed of `AgentEvent`s (token-by-token streaming over HTTP) |
| `POST`   | `/agent/completion` | Lightweight one-shot completion (no session) |
| `POST`   | `/agent/list-models` | Provider model introspection (POST so config/apiKey doesn't end up in URL logs) |
| `GET`    | `/agent/events` | SSE event stream (subscribe to a session's events over plain HTTP) |
| `POST`   | `/agent/permission-request` | Blocking: submit a permission request and wait for the UI's verdict |
| `POST`   | `/agent/permission-respond` | UI side: approve or deny a pending permission request |
| `GET`    | `/agent/permission-pending` | List pending permission requests (global or per-session) |
| `GET`    | `/chat/sessions` | List chat sessions |
| `POST`   | `/chat/sessions` | Create a chat session |
| `DELETE` | `/chat/sessions/:id` | Delete a chat session |
| `GET`    | `/chat/sessions/:id/messages` | List messages (supports `since`, `limit`) |
| `POST`   | `/chat/sessions/:id/messages` | Append a chat message |
| `DELETE` | `/chat/sessions/:id/messages` | Clear messages |
| `GET`    | `/chat/images/:sessionId/:filename` | Serve an embed |

`server/api-types.ts` is the single source of truth for response shapes. `httpJson(c, op, data)` and `wsReply(ws, msg, data)` both consume it, so HTTP/WS drift is a TypeScript error.

##### OpenAPI / Swagger UI

`createSnaApp()` returns an `OpenAPIHono` instance, so the spec is generated from the same Zod schemas that validate incoming requests. Once the server is running you get three companion endpoints for free:

| Path | Contents |
|------|----------|
| `/openapi.json` | Raw OpenAPI 3.1 document |
| `/docs` | Swagger UI (interactive try-it-out) |
| `/spec` | Plain-text JSON viewer (no JS) |

Generating clients from this spec, or pointing Postman / Insomnia / Bruno at it, works without any extra build step.

#### WebSocket (`/ws`)

A single connection covers everything. Request shape is `{ type, rid?, ...args }`; the server replies with `{ type, rid?, ...data }` or `{ type: "error", rid?, message }`. Push channels (no rid):

| Push type | When |
|-----------|------|
| `agent.event` | Per-session event stream after `agent.subscribe` |
| `sessions.snapshot` | On connect, on session create/remove, on state change |
| `session.lifecycle` | `started` / `killed` / `exited` / `crashed` / `restarted` |
| `session.config-changed` | After `set-model` / `set-permission-mode` |
| `session.state-changed` | When agent state transitions |
| `permission.request` | Agent needs approval (after `permission.subscribe`) |

`agent.subscribe({ session, since: 0 })` is a unified channel: it replays canonical history from `chat_messages` and continues with live events. There's no separate "list messages then subscribe" sequence.

### Permission flow

Claude Code uses a PreToolUse hook; Codex uses JSON-RPC bidirectional approval; OpenCode emits `permission.updated` SSE events and accepts `POST /session/:id/permissions/:permID` responses. SNA hides the difference behind one flow:

1. The agent tries to call a tool.
2. Provider-specific glue posts a `permission_needed` request to the running server (Claude: hook script; Codex: rpc → provider).
3. Server emits `permission.request` to subscribers and blocks the agent.
4. UI calls `permission.respond({ session, approved })`.
5. Server unblocks the agent.

If the owning session is removed while a permission request is pending, the pending request resolves as denied before the session row and runtime chain are deleted.

`ClaudeCodeProvider.spawn` auto-injects the hook via `--settings`. Consumers don't write `.claude/settings.json` themselves. Safe tools (`Read`, `Glob`, `Grep`, `Agent`, `TodoRead`, `TodoWrite`) auto-allow without prompting.

### Runtime control

A session doesn't need to die to change shape:

- `agent.set-model` — control message, no respawn
- `agent.set-permission-mode` — control message, no respawn
- `agent.interrupt` — cancel the current turn, process stays alive
- `agent.restart` — kill + respawn with the same `Session.config` (cross-runtime restarts drop runtime-specific flags). For single-field mutations prefer `agent.update` — it picks the cheaper path per runtime.
- `agent.resume` — rebuild canonical history → provider-native format → fresh process picks up where the last one left off

### One-shot completion

`completion({ prompt, model?, provider?, systemPrompt?, ... })` skips the session machinery. Each provider picks its own one-shot strategy explicitly:

- **Claude Code** — `claude -p --output-format json` (stateless, no daemon to reuse).
- **Codex** — `getRuntimePool().findCompatible(cwd)` first; if a pooled `codex app-server` daemon already serves this cwd, run the one-shot through it as a thread (≈2× faster on warm pools). Otherwise fall back to `codex exec --json --ephemeral`.
- **OpenCode** — same lookup-first pattern; reuses an existing `opencode serve` daemon when present, otherwise spins up an ephemeral one and tears it down.

Returns `{ text, usage, costUsd, durationMs, durationApiMs, model }`. Used for short single-prompt jobs — naming a chat, summarising a doc, autocomplete — where multi-turn would be overkill.

`runOnce()` follows the same shape (full session machinery, no manual cleanup) but goes through the agent event pipeline. It accepts an `onDelta` text-chunk callback or an `onEvent` full-event callback for in-process callers. Network consumers can subscribe to the same stream via `POST /agent/run-once/stream`, which runs the call and pipes every `AgentEvent` over Server-Sent Events until the terminal `complete` / `error`. The client SDK wraps this as `client.agent.runOnceStream(...)` returning an `AsyncIterable<AgentEvent>`.

Optionally streaming for `completion()`: pass `onDelta: (chunk: string) => void` to receive assistant-text chunks as the provider produces them. The Promise still resolves with the full concatenated text plus usage/cost — the callback is a side channel, not a replacement. Per-provider wiring:

- **Claude Code** — upgrades the `-p` call to `--output-format stream-json --include-partial-messages` and forwards `content_block_delta.text_delta` events.
- **Codex (pool)** — listens on the same `assistant_delta` agent event the session path already emits.
- **Codex (ephemeral)** — parses `codex exec --json` stdout line-by-line for `agent_message.delta` / `item.updated` events instead of buffering until close.
- **OpenCode** — currently a no-op (the SDK call is single-shot); listed for completeness so consumer code can stay provider-agnostic.

### Reasoning effort & service tier

Two provider-aware latency knobs, both flow through `SpawnOptions` and `CompleteOptions`:

- **`reasoningLevel: 0 | 1 | 2 | 3 | 4 | 5`** — provider-agnostic, lightest → heaviest. Each adapter translates this to its native enum:

  | level | Claude Code (`--effort`) | Codex (`model_reasoning_effort` / `turn/start.effort`) |
  |---:|---|---|
  | 0 | `low` | `none` |
  | 1 | `low` (collapse) | `minimal` |
  | 2 | `medium` | `low` |
  | 3 | `high` | `medium` |
  | 4 | `xhigh` | `high` |
  | 5 | `max` | `xhigh` |

  OpenCode currently ignores it. Omit to inherit the provider's own default.

- **`providerOptions.serviceTier: string`** — Codex-only, mirrors the `/fast` slash command. Common values: `"priority"` (fast lane, premium billing), `"flex"`, `"batch"`. Threaded into `turn/start.serviceTier` for the pool path; `-c service_tier=<v>` for the ephemeral `codex exec` path. Intentionally NOT auto-translated to Claude — Claude's `/fast` is a faster MODEL variant with separate billing (the CLI prompts "Fast mode requires extra usage billing"), so for Claude set `model` to the desired variant directly.

### Launcher API

`startSnaServer(options)` is the recommended way to run the server inside another app:

```ts
import { startSnaServer } from "@sna-sdk/core/node"; // or /electron

const sna = await startSnaServer({
  port: 3099,
  dbPath: path.join(process.cwd(), "data/sna.db"),
  maxSessions: 20,
  permissionMode: "acceptEdits",
  runtimePaths: {
    claudeCode: "/opt/homebrew/bin/claude",
  },
  onLog: (line) => console.log("[sna]", line),
});
// sna.process — ChildProcess
// sna.port    — actual port
// sna.stop()  — graceful SIGTERM
```

The Electron variant additionally resolves asar-unpacked paths and locates the consumer app's electron-rebuilt `better-sqlite3`. Add `asarUnpack: ["node_modules/@sna-sdk/core/**"]` to electron-builder.

Supported `SnaServerOptions`: `port`, `dbPath`, `cwd`, `maxSessions`, `permissionMode`, `model`, `nativeBinding`, `env`, `runtimePaths`, `readyTimeout`, `onLog`.

### Configuration

`@sna-sdk/core` exposes `getConfig()` / `setConfig()` from `config.ts`. Defaults are overridden by env vars, then by `setConfig()` calls, then by per-call parameters.

| Env var | Purpose |
|---------|---------|
| `SNA_PORT` | Server port (default 3099) |
| `SNA_MODEL` | Default model |
| `SNA_PERMISSION_MODE` | Default permission mode |
| `SNA_MAX_SESSIONS` | Cap on concurrent agent processes (default 5) |
| `SNA_DB_PATH` | SQLite path (default `./data/sna.db`) |
| `SNA_DATA_DIR` | Base dir for embeds/images |
| `SNA_PERMISSION_TIMEOUT_MS` | Auto-deny after this many ms (0 = app controls) |
| `SNA_SQLITE_NATIVE_BINDING` | Absolute path to `better_sqlite3.node` (Electron) |
| `SNA_CLAUDE_COMMAND` | Override the Claude binary |
| `SNA_CODEX_COMMAND` | Override the Codex binary |
| `SNA_OPENCODE_COMMAND` | Override the OpenCode binary |
| `SNA_GROK_COMMAND` | Override the Grok binary |
| `SNA_CURSOR_COMMAND` | Override the Cursor headless agent binary |

Embedded hosts should prefer `startSnaServer({ runtimePaths })`, which maps to
the same `SNA_*_COMMAND` variables while keeping runtime path registration in
the server startup config.
