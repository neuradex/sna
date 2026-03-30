# @sna-sdk/core

Server runtime for [Skills-Native Applications](https://github.com/neuradex/sna) — where Claude Code is the runtime, not an external LLM API.

## What's included

- **Skill event pipeline** — emit, SSE streaming, and hook scripts
- **Dispatch** — unified event dispatcher with validation, session lifecycle, and cleanup (`sna dispatch` CLI + programmatic API)
- **SQLite database** — schema and `getDb()` for `skill_events`
- **Hono server factory** — `createSnaApp()` with events, emit, agent, and run routes
- **Lifecycle CLI** — `sna api:up`, `sna api:down`, `sna dispatch`, `sna validate`
- **Agent providers** — Claude Code and Codex process management

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
import { createSnaApp } from "@sna-sdk/core/server";

const sna = createSnaApp();
// Provides: GET /events (SSE), POST /emit, GET /health, POST /agent/start
```

### Access the database

```ts
import { getDb } from "@sna-sdk/core/db/schema";

const db = getDb(); // SQLite instance (data/sna.db)
```

## Exports

| Import path | Contents |
|-------------|----------|
| `@sna-sdk/core` | `DEFAULT_SNA_PORT`, `DEFAULT_SNA_URL`, `dispatchOpen`, `dispatchSend`, `dispatchClose`, `createDispatchHandle`, `SEND_TYPES`, `loadSkillsManifest`, types |
| `@sna-sdk/core/server` | `createSnaApp()`, route handlers, `SessionManager` |
| `@sna-sdk/core/db/schema` | `getDb()`, `SkillEvent` type |
| `@sna-sdk/core/providers` | Agent provider factory, `ClaudeCodeProvider` |
| `@sna-sdk/core/lib/sna-run` | `snaRun()` helper for spawning Claude Code |

## Documentation

- [Architecture](https://github.com/neuradex/sna/blob/main/docs/architecture.md)
- [Skill Authoring](https://github.com/neuradex/sna/blob/main/docs/skill-authoring.md)
- [App Setup](https://github.com/neuradex/sna/blob/main/docs/app-setup.md)

## License

MIT
