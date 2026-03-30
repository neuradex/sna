## Design Decisions

### SDK DB scope (`sna.db`)

The SDK database (`data/sna.db`) manages two concerns:

```
sna.db:
  skill_events   — Skill execution state tracking + SSE delivery
  chat_sessions  — Session management (main + background)
  chat_messages  — Chat history persistence (replaces localStorage)
```

**`skill_events`** has a foreign key to `chat_sessions`:
```sql
skill_events:
  id, session_id (FK → chat_sessions.id), skill, type, message, data, created_at
```

**Key rule:** Application DB is entirely separate. The SDK does not dictate what DB technology or ORM the application uses. Applications can use PostgreSQL, Supabase, SQLite, Prisma, Drizzle, or raw SQL — the SDK does not care.

### Event dispatch: `sna dispatch` (primary) and `emit.js` (legacy)

`sna dispatch` is the primary path for emitting skill events. It provides:
- Skill name validation against `.sna/skills.json` (fallback: SKILL.md existence)
- Session-based lifecycle: `open` → `send` (called/start/milestone/progress) → `close`
- Automatic emission of both canonical and legacy event types on close
- Background session cleanup via API notification

`emit.js` is the legacy path, still available for backward compatibility. Both check for `SNA_SESSION_ID`:

- **Present** (running inside SDK-managed session): writes to `sna.db` with session FK, participates in the event pipeline
- **Absent** (running outside SDK, e.g., terminal): console output only, skips DB write and lifecycle processing

This ensures event emission never breaks when called outside the SDK, while fully participating when running inside it.

The SDK sets `SNA_SESSION_ID` when spawning agent processes:
```
SessionManager.spawn(sessionId) → env: SNA_SESSION_ID=<id> → Claude Code → sna dispatch / emit.js reads env
```

### Skill execution locking is application responsibility

**Conclusion after analysis:** Mutual exclusion for skill execution belongs to the application, not the SDK.

**Rationale:**
- Locking requires domain knowledge (which resources conflict, at what granularity)
- Domain knowledge lives in the application, not the SDK
- The SDK cannot know application schema, relations, or business rules
- Forcing schema declaration (Prisma, YAML, etc.) on applications is overreach — applications should be free to use any DB technology

**What the SDK provides:**
- Session management (create, start, stop, list)
- Event pipeline (invoked, start, milestone, complete)
- `runSkillInBackground` as the execution mechanism

**What the application does:**
- Checks for conflicts before calling `runSkillInBackground`
- Manages its own locks using whatever mechanism fits (in-memory, DB, etc.)

```ts
// Application-level locking example
const handleAnalyze = (sessionId: number) => {
  if (isResourceBusy(sessionId)) {
    toast.error("This session is being processed");
    return;
  }
  markBusy(sessionId);
  runSkillInBackground(`form-analyze ${sessionId}`);
};
```

### Skill execution status: `invoked` event (planned)

SDK records an `invoked` event immediately when a skill execution is requested, before the agent process starts.

**Current flow:**
```
User clicks → /agent/start → Claude boots → emit.js --type start → UI updates
                              (seconds of silence)
```

**Target flow:**
```
User clicks → /agent/start → SDK writes "invoked" → UI updates immediately → Claude boots → emit.js --type start
```

- `invoked` = request accepted, about to execute
- `start` = skill logic has begun (from emit.js inside the skill)
- These are separate phases, not duplicates

### Chat history persistence

Chat messages are persisted server-side in `sna.db`. The `SessionManager` automatically saves agent events (assistant messages, tool use, tool results, completions, errors) to the `chat_messages` table. User messages are persisted when sent via `POST /agent/send` or `POST /agent/start`.

**Schema:**
```sql
chat_sessions (id, label, type, meta, created_at)
chat_messages (id, session_id FK, role, content, skill_name, meta, created_at)
```

The `meta` column on `chat_sessions` stores arbitrary JSON metadata for multi-app identification (e.g., `{ "app": "loom" }` allows apps sharing a single SNA server to identify and manage only their own sessions).

**Frontend `useChatStore`** remains as a cache layer. On load, hydrate from DB via `GET /chat/sessions/:id/messages`.
