# @sna-sdk/core

HTTP/WebSocket server that wraps Claude Code, Codex, and OpenCode as backend processes, plus the launcher API for embedding it inside another app.

```
Your app → SNA server → spawn(claude-code | codex | opencode) → events back over WS
```

## What's inside

- **HTTP server (`createSnaApp`)** — Hono app (built on `@hono/zod-openapi`) with `/agent/*`, `/chat/*`, `/health` routes. Single source of truth for response shapes via `server/api-types.ts`. Live OpenAPI 3.1 spec published at `/openapi.json`, with Swagger UI at `/docs` and a plain-text viewer at `/spec`.
- **WebSocket handler (`attachWebSocket`)** — Mounts at `/ws`. Wraps the full HTTP API plus push channels (`agent.event`, `sessions.snapshot`, `permission.request`, `session.lifecycle`, `session.state-changed`, `session.config-changed`).
- **`SessionManager`** — Multi-session lifecycle, per-session event buffer, lifecycle/state/config pub/sub, permission-request bridging, `runtime_sessions` chain for per-mutation history.
- **Providers** — `ClaudeCodeProvider`, `CodexProvider`, and `OpenCodeProvider`, all exposing a uniform `AgentProcess` interface (`send`, `setModel`, `setPermissionMode`, `interrupt`, `kill`, `applyPatch`, `respondToPermission`). Codex and OpenCode are pooled through `RuntimePool`; Claude Code is stateless per-session.
- **Canonical conversation model** — `chat_messages` rows split a message into orthogonal `actor` × `kind` axes. `history/canonical.ts` rebuilds blocks; `history/{claude-code,codex,opencode}.ts` adapters convert canonical → native wire format.
- **One-shot completion** — `completion({ prompt, model?, provider?, reasoningLevel? })` for short single-prompt jobs. Each provider implements its own optimal one-shot path (Codex `exec --ephemeral` or pooled thread; Claude `-p`; OpenCode pooled session or ephemeral serve). Opportunistically reuses a pooled daemon when one is already alive for the cwd, so high-frequency callers (autocomplete, etc.) don't pay per-call cold-start.
- **Cross-provider latency knobs** — `reasoningLevel: 0..5` (Claude `--effort` / Codex `model_reasoning_effort`) and Codex-only `providerOptions.serviceTier` (mirrors Codex `/fast` slash command: `"priority"`, `"flex"`, `"batch"`).
- **Launcher API** — `startSnaServer({ port, dbPath, ... })` from `@sna-sdk/core/node` or `@sna-sdk/core/electron`. Forks the standalone server, resolves native bindings, waits for ready.
- **PreToolUse hook** — `scripts/hook.ts`, auto-injected by `ClaudeCodeProvider.spawn()`. No manual `.claude/settings.json` editing needed.

## Install

```bash
npm install @sna-sdk/core
```

Peer dependencies: `better-sqlite3` (required), `langfuse` (optional, for tracing).

## Usage

### Embed the server

```ts
import { startSnaServer } from "@sna-sdk/core/node";

const sna = await startSnaServer({
  port: 3099,
  dbPath: "./data/sna.db",
  maxSessions: 20,
});
```

For Electron, use `@sna-sdk/core/electron` and add `asarUnpack: ["node_modules/@sna-sdk/core/**"]`.

### Mount the routes manually

```ts
import { createSnaApp, attachWebSocket, SessionManager } from "@sna-sdk/core/server";
import { serve } from "@hono/node-server";

const sessionManager = new SessionManager({ maxSessions: 10 });
const app = createSnaApp({ sessionManager });
const server = serve({ fetch: app.fetch, port: 3099 });
attachWebSocket(server, sessionManager);
```

### One-shot completion

```ts
import { completion } from "@sna-sdk/core";

const result = await completion({
  prompt: "Summarize this in one sentence: ...",
  model: "claude-haiku-4-5",
  provider: "claude-code",
  label: "summarizer",
});
// result.text, result.usage, result.costUsd, result.durationMs, result.model
```

Autocomplete-grade fast path:

```ts
await completion({
  prompt: "...",
  provider: "codex",
  model: "gpt-5.4-mini",
  reasoningLevel: 0,                            // none reasoning on Codex
  providerOptions: { serviceTier: "priority" }, // Codex `/fast` lane
});
```

Streaming UX with the same call — pass `onDelta` to receive text chunks
as the provider produces them. The Promise still resolves to the full
result; the callback is purely a side channel for typewriter rendering
or autocomplete previews.

```ts
await completion({
  prompt: "Summarize ...",
  provider: "codex",
  onDelta: (chunk) => process.stdout.write(chunk),
});
```

`onDelta` is wired for the `claude-code` and `codex` providers
(both pool and ephemeral paths). On OpenCode the SDK call is single-shot,
so the callback is a documented no-op there for now.

`runOnce()` accepts the same `onDelta` plus an `onEvent` callback for
the full agent event stream (tool_use, thinking, complete, ...). For
network consumers, `POST /agent/run-once/stream` pipes those same
events over SSE — `client.agent.runOnceStream(...)` wraps that as an
`AsyncIterable<AgentEvent>`.

Pre-warm the pool once at startup so subsequent calls hit the
"daemon already alive" fast path inside `complete()`:

```ts
import { getRuntimePool, getProvider } from "@sna-sdk/core/providers";

await getRuntimePool().prepare(
  { cwd: process.cwd() },
  getProvider("codex"),
);
```

### Direct DB access

```ts
import { getDb } from "@sna-sdk/core/db/schema";

const db = getDb();
```

## Exports

| Import path | Contents |
|-------------|----------|
| `@sna-sdk/core` | Default port/url, types (`AgentEvent`, `Session`, `SessionInfo`, `ChatSession`, `ChatMessage`, `CanonicalBlock`, `EmbedRecord`, …), `completion`, config helpers |
| `@sna-sdk/core/server` | `createSnaApp`, `attachWebSocket`, `SessionManager`, `snaPortRoute`, `buildCanonicalFromDb`, `completion`, `runOnce`, related types |
| `@sna-sdk/core/db/schema` | `getDb`, `resetDb`, schema types (`ChatSession`, `ChatMessage`, `ChatActor`, `ChatKind`) |
| `@sna-sdk/core/providers` | `getProvider`, `registerProvider`, `getRuntimePool`, `ClaudeCodeProvider`, `CodexProvider`, `OpenCodeProvider`, `RuntimePool`, schemas (`SpawnOptionsSchema`, `RuntimeConfigSchema`, `RuntimeHandleSchema`) |
| `@sna-sdk/core/electron` | `startSnaServer` (Electron-aware launcher) |
| `@sna-sdk/core/node` | `startSnaServer` (plain Node launcher) |

## Environment variables

| Var | Purpose |
|-----|---------|
| `SNA_PORT` | Server port (default 3099) |
| `SNA_MODEL` | Default model |
| `SNA_PERMISSION_MODE` | Default permission mode |
| `SNA_MAX_SESSIONS` | Cap on alive subprocesses (default 5) |
| `SNA_DB_PATH` | SQLite path (default `./data/sna.db`) |
| `SNA_DATA_DIR` | Base dir for embeds/images |
| `SNA_PERMISSION_TIMEOUT_MS` | Auto-deny after N ms (0 = app controls) |
| `SNA_SQLITE_NATIVE_BINDING` | Absolute path to `better_sqlite3.node` (Electron packaged apps) |
| `SNA_CLAUDE_COMMAND` | Override the Claude binary |

## Documentation

- [Architecture](https://github.com/neuradex/sna/blob/main/docs/architecture.md)
- [App Setup](https://github.com/neuradex/sna/blob/main/docs/app-setup.md)
- [Design Decisions](https://github.com/neuradex/sna/blob/main/docs/design-decisions.md)

## License

MIT
