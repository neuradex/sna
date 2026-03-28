# @sna-sdk/core

Server runtime for [Skills-Native Applications](https://github.com/neuradex/sna) — where Claude Code is the runtime, not an external LLM API.

## What's included

- **Skill event pipeline** — emit, SSE streaming, and hook scripts
- **SQLite database** — schema and `getDb()` for `skill_events`
- **Hono server factory** — `createSnaApp()` with events, emit, agent, and run routes
- **Lifecycle CLI** — `sna api:up`, `sna api:down`
- **Agent providers** — Claude Code and Codex process management

## Install

```bash
npm install @sna-sdk/core
```

## Usage

### Emit skill events

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
| `@sna-sdk/core` | `DEFAULT_SNA_PORT`, `DEFAULT_SNA_URL`, types |
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
