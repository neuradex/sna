# @sna-sdk/core

Server runtime for [Skills-Native Applications](https://github.com/neuradex/sna) — where Claude Code is the runtime, not an external LLM API.

## What's included

- **Skill event pipeline** — emit, SSE streaming, and hook scripts
- **Dispatch** — unified event dispatcher with validation, session lifecycle, and cleanup (`sna dispatch` CLI + programmatic API)
- **SQLite database** — schema and `getDb()` for `skill_events`, `chat_sessions`, `chat_messages`
- **Hono server factory** — `createSnaApp()` with events, emit, agent, chat, and run routes
- **WebSocket API** — `attachWebSocket()` wrapping all HTTP routes over a single WS connection
- **One-shot execution** — `POST /agent/run-once` for single-request LLM calls
- **CLI** — `sna up/down/status`, `sna dispatch`, `sna gen client`, `sna tu` (mock API testing)
- **Agent providers** — Claude Code and Codex process management
- **Multi-session** — `SessionManager` with event pub/sub, permission management, and session metadata

## Install

```bash
npm install @sna-sdk/core
```

## Usage

### Dispatch skill events (recommended)

```bash
# CLI
ID=$(sna dispatch open --skill my-skill)
sna dispatch $ID start --message "Starting..."
sna dispatch $ID milestone --message "Step done"
sna dispatch $ID close --message "Done."
```

```typescript
// Programmatic
import { createDispatchHandle } from "@sna-sdk/core";

const h = createDispatchHandle({ skill: "my-skill" });
h.start("Starting...");
h.milestone("Step done");
await h.close();
```

### Emit skill events (legacy, deprecated)

> Use `sna dispatch` instead. `emit.js` remains for backward compatibility.

```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type start --message "Starting..."
```

Event types: `start` | `progress` | `milestone` | `complete` | `error`

### Mount server routes

```ts
import { createSnaApp, attachWebSocket } from "@sna-sdk/core/server";
import { serve } from "@hono/node-server";

const sna = createSnaApp();
// HTTP: GET /health, GET /events (SSE), POST /emit, /agent/*, /chat/*
const server = serve({ fetch: sna.fetch, port: 3099 });
// WS: ws://localhost:3099/ws — all routes available over WebSocket
attachWebSocket(server, sessionManager);
```

### Access the database

```ts
import { getDb } from "@sna-sdk/core/db/schema";

const db = getDb(); // SQLite instance (data/sna.db)
```

## Exports

| Import path | Contents |
|-------------|----------|
| `@sna-sdk/core` | `DEFAULT_SNA_PORT`, `DEFAULT_SNA_URL`, `dispatchOpen`, `dispatchSend`, `dispatchClose`, `createDispatchHandle`, types (`AgentEvent`, `Session`, `SessionInfo`, `ChatSession`, `ChatMessage`, `SkillEvent`, etc.) |
| `@sna-sdk/core/server` | `createSnaApp()`, `attachWebSocket()`, route handlers, `SessionManager` |
| `@sna-sdk/core/server/routes/agent` | `createAgentRoutes()`, `runOnce()` |
| `@sna-sdk/core/db/schema` | `getDb()`, `ChatSession`, `ChatMessage`, `SkillEvent` types |
| `@sna-sdk/core/providers` | Agent provider factory, `ClaudeCodeProvider` |
| `@sna-sdk/core/lib/sna-run` | `snaRun()` helper for spawning Claude Code |
| `@sna-sdk/core/testing` | `startMockAnthropicServer()` for testing without real API calls |

## Documentation

- [Architecture](https://github.com/neuradex/sna/blob/main/docs/architecture.md)
- [Skill Authoring](https://github.com/neuradex/sna/blob/main/docs/skill-authoring.md)
- [App Setup](https://github.com/neuradex/sna/blob/main/docs/app-setup.md)

## License

MIT
