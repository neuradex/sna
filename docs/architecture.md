## SNA Architecture

### What is SNA?

Skills-Native Application — a platform where **Claude Code is the runtime**, not an external LLM API. Skills (`.claude/skills/<name>/SKILL.md`) instruct Claude Code to execute scripts, reason over results, and emit real-time events to the frontend via SSE.

```
Traditional:  your code → LLM API → parse → act
SNA:          SKILL.md → Claude Code → scripts → SQLite → SSE → UI
```

### Package Structure

| Package | npm name | Role |
|---------|----------|------|
| `packages/core` | `@sna-sdk/core` | Server runtime, DB, CLI, providers, emit/hook scripts |
| `packages/react` | `@sna-sdk/react` | React hooks, components, stores (no server-side code) |

### DB Separation (IMPORTANT)

SNA uses **two separate SQLite databases**:

| Database | Owner | Contents |
|----------|-------|----------|
| `data/sna.db` | `@sna-sdk/core` | `skill_events` table only |
| `data/<app>.db` | Application | App-specific tables (targets, sessions, etc.) |

**Rules:**
- Applications MUST NOT define `skill_events` in their own DB
- Applications MUST NOT write to `data/sna.db` directly
- All skill event operations go through SDK scripts or SDK server routes

### Skill Event Pipeline

The entire pipeline is owned by `@sna-sdk/core`:

```
Skill execution
  → emit.js writes to data/sna.db
  → SDK standalone server reads data/sna.db
  → GET /events (SSE) streams to frontend
  → useSkillEvents hook (SDK react) updates UI
```

#### Emitting Events

Skills emit events using the SDK CLI script:

```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill <name> --type <type> --message "<text>" [--data '<json>']
```

**NEVER use a local `scripts/emit.ts` in the application.** Always use the SDK script.

#### Event Types

| Type | When |
|------|------|
| `start` | First thing a skill does |
| `progress` | Incremental updates inside loops |
| `milestone` | Significant checkpoint |
| `complete` | Skill finished — frontend auto-refreshes |
| `error` | Something failed |

Every skill must emit: `start` → (milestones) → `complete` or `error`.

### SDK Server

`@sna-sdk/core` provides a standalone Hono server started via CLI:

```bash
node node_modules/@sna-sdk/core/dist/scripts/sna.js api:up
```

This server provides:
- `GET /events` — SSE stream of skill_events from `data/sna.db`
- `POST /emit` — Write a skill event
- `GET /health` — Health check
- `POST /agent/start` — Start an agent session
- `GET /agent/events` — Agent SSE stream

Applications discover the server URL via `/api/sna-port` or the default port (3099).

### Hook Script

The permission hook notifies the UI when Claude requests permissions:

```json
// .claude/settings.json
{
  "hooks": {
    "PermissionRequest": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/node_modules/@sna-sdk/core/dist/scripts/hook.js",
        "async": true
      }]
    }]
  }
}
```

### Application Responsibilities

Applications are responsible for:
- App-specific DB tables and `getDb()` (their own database)
- API routes for app-specific data
- Skill definitions in `.claude/skills/`
- Mounting/configuring the SDK (SnaProvider, hooks)

Applications should NOT:
- Define `skill_events` table
- Create their own emit/hook scripts
- Create their own SSE events route
- Write directly to `data/sna.db`
