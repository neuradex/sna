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
- **One-shot completion** — `completion({ prompt, model?, provider? })` for short single-prompt jobs.
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

### Direct DB access

```ts
import { getDb } from "@sna-sdk/core/db/schema";

const db = getDb();
```

## Exports

| Import path | Contents |
|-------------|----------|
| `@sna-sdk/core` | Default port/url, types (`AgentEvent`, `Session`, `SessionInfo`, `ChatSession`, `ChatMessage`, `CanonicalBlock`, `EmbedRecord`, …), `completion`, config helpers |
| `@sna-sdk/core/server` | `createSnaApp`, `attachWebSocket`, `SessionManager`, route handlers |
| `@sna-sdk/core/server/routes/agent` | `createAgentRoutes`, `runOnce` |
| `@sna-sdk/core/server/routes/chat` | `createChatRoutes` |
| `@sna-sdk/core/db/schema` | `getDb`, schema types |
| `@sna-sdk/core/providers` | `getProvider`, `ClaudeCodeProvider`, `CodexProvider` |
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
