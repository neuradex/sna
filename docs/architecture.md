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
| `packages/core` | `@sna-sdk/core` | Server runtime, DB, CLI, providers, emit/hook scripts, code generation |
| `packages/react` | `@sna-sdk/react` | React hooks, components, stores, typed client (no server-side code) |

### DB Separation (IMPORTANT)

SNA uses **two separate SQLite databases**:

| Database | Owner | Contents |
|----------|-------|----------|
| `data/sna.db` | `@sna-sdk/core` | `chat_sessions`, `chat_messages`, `skill_events` |
| `data/<app>.db` | Application | App-specific tables (targets, sessions, etc.) |

**Schema:**

```sql
chat_sessions (id TEXT PK, label, type, created_at)
chat_messages (id INTEGER PK, session_id FK, role, content, skill_name, meta, created_at)
skill_events  (id INTEGER PK, session_id FK nullable, skill, type, message, data, created_at)
```

**Rules:**
- Applications MUST NOT define `skill_events`, `chat_sessions`, or `chat_messages` in their own DB
- Applications MUST NOT write to `data/sna.db` directly
- All skill event operations go through SDK scripts or SDK server routes

### Skill Event Pipeline

The entire pipeline is owned by `@sna-sdk/core`:

```
Skill execution
  → emit.js writes to data/sna.db (if SNA_SESSION_ID is set)
  → SDK standalone server reads data/sna.db
  → GET /events (SSE) streams to frontend
  → useSkillEvents hook (SDK react) updates UI
```

#### Context-Aware emit.js

`emit.js` checks for `SNA_SESSION_ID` environment variable:
- **Present** (running inside SDK-managed session): writes to `sna.db` with session FK
- **Absent** (running outside SDK, e.g., terminal): console output only, skips DB write

The SDK sets `SNA_SESSION_ID` when spawning agent processes.

#### Event Types

| Type | When |
|------|------|
| `invoked` | SDK records immediately on `/agent/start` (before Claude boots) |
| `start` | First thing a skill does (from emit.js) |
| `progress` | Incremental updates inside loops |
| `milestone` | Significant checkpoint |
| `complete` | Skill finished — frontend auto-refreshes |
| `error` | Something failed |

### SDK Server

`@sna-sdk/core` provides a standalone Hono server started via CLI:

```bash
node node_modules/@sna-sdk/core/dist/scripts/sna.js api:up
```

This server provides:
- `GET /health` — Health check
- `GET /events` — SSE stream of skill_events
- `POST /emit` — Write a skill event
- `POST /agent/start` — Start an agent session (records `invoked` event)
- `POST /agent/send` — Send message to agent
- `GET /agent/events` — Agent SSE stream
- `POST /agent/sessions` — Create session
- `GET /agent/sessions` — List sessions
- `DELETE /agent/sessions/:id` — Remove session
- `GET /chat/sessions` — List chat sessions
- `POST /chat/sessions` — Create chat session
- `DELETE /chat/sessions/:id` — Delete chat session
- `GET /chat/sessions/:id/messages` — Get messages
- `POST /chat/sessions/:id/messages` — Add message
- `DELETE /chat/sessions/:id/messages` — Clear messages

Applications discover the server URL via `/api/sna-port` or the default port (3099).

### Hook Script

The permission hook notifies the UI when Claude requests permissions:

```json
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

### Typed Client Generation

`sna gen client` reads `sna.args` from SKILL.md frontmatter and generates a TypeScript client:

```bash
sna gen client --out src/sna-client.ts
```

See [Skill Authoring](skill-authoring.md) for frontmatter schema and [App Setup](app-setup.md) for usage.

### Application Responsibilities

Applications are responsible for:
- App-specific DB tables and `getDb()` (their own database)
- API routes for app-specific data
- Skill definitions in `.claude/skills/`
- Mounting/configuring the SDK (SnaProvider, hooks)
- Skill execution locking (if needed — SDK does not manage this)

Applications should NOT:
- Define `skill_events`, `chat_sessions`, or `chat_messages` tables
- Create their own emit/hook scripts
- Create their own SSE events route
- Write directly to `data/sna.db`
