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

### Skill Event Pipeline (Dispatch)

All skill events flow through the unified dispatcher (`@sna-sdk/core/lib/dispatch`):

```
Skill execution
  → dispatch.open({ skill }) — validate against .sna/skills.json
  → dispatch.send(id, { type, message }) — write to data/sna.db
  → dispatch.close(id) — write terminal events + kill bg agent process
  → SDK standalone server reads data/sna.db
  → GET /events (SSE) streams to frontend
  → useSkillEvents hook (SDK react) updates UI
```

#### CLI Usage

```bash
ID=$(sna dispatch open --skill form-analyze)
sna dispatch $ID start --message "Starting..."
sna dispatch $ID milestone --message "5 items found"
sna dispatch $ID close --message "Done"        # success → kills bg session
sna dispatch $ID close --error "Failed"         # error → kills bg session
```

#### SDK (Programmatic) Usage

```typescript
import { createDispatchHandle } from "@sna-sdk/core";

const d = createDispatchHandle({ skill: "form-analyze" });
d.start("Starting...");
d.milestone("5 items found");
await d.close();  // or d.close({ error: "reason" })
```

Workflow engine, hook script, and legacy `emit.js` all route through dispatch internally.

#### Dispatch Lifecycle

| Phase | What happens |
|-------|-------------|
| `open` | Validate skill against `.sna/skills.json` (fallback: SKILL.md), create in-memory session |
| `send` | Write event to `skill_events` table. Valid types: `called`, `start`, `progress`, `milestone`, `permission_needed` |
| `close` | Write terminal events (`complete`+`success` or `error`+`failed`), notify SNA API server to kill background agent process |

#### Validation

`sna gen client` generates `.sna/skills.json` — the skill registry. Dispatch validates skill names against this file on `open()`. If the file is missing, falls back to checking `.claude/skills/<name>/SKILL.md` existence.

Run `sna validate` to check project health:
- `.sna/skills.json` exists and skills match SKILL.md files
- `.claude/settings.json` has the PreToolUse hook
- `node_modules` installed

### SDK Server

`@sna-sdk/core` provides a standalone Hono server started via CLI:

```bash
sna api:up    # or: node node_modules/@sna-sdk/core/dist/scripts/sna.js api:up
```

CLI commands:
- `sna up` / `sna down` — Full lifecycle (install, DB, API server, dev server)
- `sna validate` — Check project health (skills.json, hooks, deps)
- `sna dispatch` — Unified event dispatcher (open/send/close)
- `sna gen client` — Generate typed client + `.sna/skills.json`

This server provides:
- `GET /health` — Health check
- `GET /events` — SSE stream of skill_events
- `POST /emit` — Write a skill event
- `POST /agent/start` — Start an agent session (records `invoked` event)
- `POST /agent/send` — Send message to agent (auto-persists to chat_messages)
- `GET /agent/events` — Agent SSE stream
- `POST /agent/sessions` — Create session
- `GET /agent/sessions` — List sessions (includes `state` field)
- `DELETE /agent/sessions/:id` — Remove session
- `POST /agent/kill` — Kill agent in a session
- `GET /agent/status` — Check session status
- `POST /agent/permission-request` — Hook submits permission request (blocks until UI responds)
- `POST /agent/permission-respond` — UI approves/denies a pending permission
- `GET /agent/permission-pending` — UI polls for pending permission requests
- `GET /chat/sessions` — List chat sessions
- `POST /chat/sessions` — Create chat session
- `DELETE /chat/sessions/:id` — Delete chat session
- `GET /chat/sessions/:id/messages` — Get messages
- `POST /chat/sessions/:id/messages` — Add message
- `DELETE /chat/sessions/:id/messages` — Clear messages

Applications discover the server URL via `/api/sna-port` or the default port (3099).

### Hook Script

The PreToolUse hook enables the permission approval flow. It fires before every tool execution, submits a request to the SNA API, and waits for user approval from the UI:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/node_modules/@sna-sdk/core/dist/scripts/hook.js"
      }]
    }]
  }
}
```

The SDK auto-injects this via `--settings` when spawning agents (unless `bypassPermissions` is set). Safe tools (Read, Glob, Grep, etc.) are auto-allowed without prompting.

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
