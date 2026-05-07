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
- `lastStartConfig` — `{ provider, modelProvider, model, permissionMode, providerOptions, ... }`, used by `agent.restart` to bring the same config back
- `state` — `idle` | `processing` | `waiting` | `permission`
- `ccSessionId` — the runtime's own session id, captured from the `init` event so `--resume` works

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

Twelve normalized event types flow over the agent stream:

| Type | Meaning |
|------|---------|
| `init` | Session initialized; carries the provider's session id |
| `thinking` | Extended thinking block, complete |
| `thinking_delta` | Streaming thinking chunk |
| `assistant` | Full assistant message |
| `assistant_delta` | Streaming assistant token chunk |
| `tool_use` | Agent is calling a tool |
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

| Method | Path | What it does |
|--------|------|--------------|
| `GET`    | `/health` | Health check |
| `POST`   | `/agent/sessions` | Create a session |
| `GET`    | `/agent/sessions` | List sessions |
| `DELETE` | `/agent/sessions/:id` | Remove a session |
| `POST`   | `/agent/start` | Start (spawn) agent in a session |
| `POST`   | `/agent/send` | Send a message |
| `POST`   | `/agent/resume` | Restart with canonical history rebuilt for the provider |
| `POST`   | `/agent/restart` | Re-spawn with the same `lastStartConfig` |
| `POST`   | `/agent/interrupt` | Interrupt current turn (process stays alive) |
| `POST`   | `/agent/set-model` | Change model at runtime |
| `POST`   | `/agent/set-permission-mode` | Change permission mode at runtime |
| `POST`   | `/agent/kill` | Kill the agent in a session |
| `GET`    | `/agent/status` | Session status snapshot |
| `POST`   | `/agent/run-once` | One-shot: spawn → run → return result → cleanup |
| `POST`   | `/agent/completion` | Lightweight one-shot completion (no session) |
| `GET`    | `/agent/events` | SSE event stream |
| `GET`    | `/chat/sessions` | List chat sessions |
| `POST`   | `/chat/sessions/:id/messages` | Append a chat message |
| `GET`    | `/chat/sessions/:id/messages` | List messages |
| `DELETE` | `/chat/sessions/:id/messages` | Clear messages |
| `GET`    | `/chat/images/:sessionId/:filename` | Serve an embed |

`server/api-types.ts` is the single source of truth for response shapes. `httpJson(c, op, data)` and `wsReply(ws, msg, data)` both consume it, so HTTP/WS drift is a TypeScript error.

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

`ClaudeCodeProvider.spawn` auto-injects the hook via `--settings`. Consumers don't write `.claude/settings.json` themselves. Safe tools (`Read`, `Glob`, `Grep`, `Agent`, `TodoRead`, `TodoWrite`) auto-allow without prompting.

### Runtime control

A session doesn't need to die to change shape:

- `agent.set-model` — control message, no respawn
- `agent.set-permission-mode` — control message, no respawn
- `agent.interrupt` — cancel the current turn, process stays alive
- `agent.restart` — kill + respawn with the same `lastStartConfig` (cross-runtime restarts drop runtime-specific flags)
- `agent.resume` — rebuild canonical history → provider-native format → fresh process picks up where the last one left off

### One-shot completion

`completion({ prompt, model?, provider?, systemPrompt?, ... })` skips the session machinery. Spawns `claude -p --output-format json` for Claude Code, `codex exec --json` for Codex, or for OpenCode briefly stands up an ephemeral `opencode serve` and runs a synchronous `client.session.prompt`. Parses the result, returns `{ text, usage, costUsd, durationMs, durationApiMs, model }`. Used for short single-prompt jobs — naming a chat, summarizing a doc — where multi-turn would be overkill.

### Launcher API

`startSnaServer(options)` is the recommended way to run the server inside another app:

```ts
import { startSnaServer } from "@sna-sdk/core/node"; // or /electron

const sna = await startSnaServer({
  port: 3099,
  dbPath: path.join(process.cwd(), "data/sna.db"),
  maxSessions: 20,
  permissionMode: "acceptEdits",
  onLog: (line) => console.log("[sna]", line),
});
// sna.process — ChildProcess
// sna.port    — actual port
// sna.stop()  — graceful SIGTERM
```

The Electron variant additionally resolves asar-unpacked paths and locates the consumer app's electron-rebuilt `better-sqlite3`. Add `asarUnpack: ["node_modules/@sna-sdk/core/**"]` to electron-builder.

Supported `SnaServerOptions`: `port`, `dbPath`, `cwd`, `maxSessions`, `permissionMode`, `model`, `nativeBinding`, `env`, `readyTimeout`, `onLog`.

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
