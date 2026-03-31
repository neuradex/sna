## Contributing

### Repository Structure

```
sna/
├── packages/
│   ├── core/    (@sna-sdk/core)  — Server runtime, DB, CLI, event pipeline, code generation
│   └── react/   (@sna-sdk/react) — React hooks, components, stores, typed client
├── docs/                          — SDK documentation (source of truth)
├── plugins/sna-builder/           — Claude Code plugin for SNA development
├── .claude-plugin/marketplace.json — Plugin marketplace definition
└── pnpm-workspace.yaml
```

### Commands

```bash
pnpm install                       # Install all dependencies
cd packages/core && pnpm build     # Build core
cd packages/react && pnpm build    # Build react
sna gen client                     # Generate typed skill client
```

### Architecture

See [docs/architecture.md](docs/architecture.md) for full details.

#### DB Separation (CRITICAL)

SDK DB (`data/sna.db`):
- `chat_sessions` — session management (id, label, type, meta, cwd, last_start_config, created_at)
- `chat_messages` — chat history persistence
- `skill_events` — skill execution state tracking (FK → chat_sessions)

Application DB (`data/<app>.db`):
- App-specific tables only
- Applications MUST NOT define `skill_events`, `chat_sessions`, or `chat_messages`

#### Event Pipeline (Dispatch)

All events flow through the unified dispatcher (`packages/core/src/lib/dispatch.ts`):

```
sna dispatch open → validate skill → create session
sna dispatch <id> start/milestone/progress → write to sna.db
sna dispatch <id> close → write complete/success → kill bg session
```

Programmatic usage:
```typescript
import { createDispatchHandle } from "@sna-sdk/core";
const d = createDispatchHandle({ skill: "form-analyze" });
d.start("Starting...");
d.milestone("5 items found");
await d.close();  // writes complete + kills bg agent process
```

Legacy `emit.js` is a thin wrapper around dispatch for backward compatibility.

#### Import Paths

- Server/DB/CLI: `@sna-sdk/core/*`
- React hooks/components/stores: `@sna-sdk/react/*`
- NEVER import from `sna/` (legacy package name)

### Tech Stack

- TypeScript (strict) + Hono + better-sqlite3 + ws + React 19
- tsup (library bundler) + pnpm 10
- Tailwind CSS v4 + Zustand + Radix UI (tooltip)

### Key Files

| File | Role |
|------|------|
| `packages/core/src/db/schema.ts` | SDK database (sna.db) — chat_sessions, chat_messages, skill_events |
| `packages/core/src/lib/dispatch.ts` | Unified event dispatcher (open/send/close lifecycle) |
| `packages/core/src/lib/parse-flags.ts` | Shared CLI flag parser |
| `packages/core/src/scripts/hook.ts` | Permission request hook (via dispatch) |
| `packages/core/src/scripts/sna.ts` | Lifecycle CLI (up, down, validate, dispatch, gen client) |
| `packages/core/src/scripts/gen-client.ts` | Typed client + `.sna/skills.json` generator |
| `packages/core/src/lib/skill-parser.ts` | SKILL.md frontmatter parser |
| `packages/core/src/server/index.ts` | createSnaApp() Hono factory |
| `packages/core/src/server/session-manager.ts` | Multi-session management, event pub/sub, permission flow |
| `packages/core/src/server/ws.ts` | WebSocket API wrapping all HTTP routes |
| `packages/core/src/server/routes/agent.ts` | Agent lifecycle, sessions, run-once, permission routes |
| `packages/core/src/server/routes/chat.ts` | Chat persistence CRUD routes |
| `packages/react/src/hooks/use-skill-events.ts` | SSE subscription hook |
| `packages/react/src/hooks/use-sna.ts` | Main hook (runSkill, runSkillInBackground) |
| `packages/react/src/hooks/use-sna-client.ts` | Typed client hook (useSnaClient) |
| `packages/react/src/hooks/use-session-manager.ts` | Session CRUD + polling (3s interval) |
| `packages/react/src/components/sna-provider.tsx` | Root React provider |
| `packages/react/src/components/sna-session.tsx` | Session scope provider (multi-session) |

### Documentation

- [Architecture](docs/architecture.md) — DB separation, event pipeline, package structure
- [Skill Authoring](docs/skill-authoring.md) — How to write skills with typed args
- [App Setup](docs/app-setup.md) — Frontend, server, Vite configuration, typed client
- [Design Decisions](docs/design-decisions.md) — DB scope, locking, invoked status
- [Testing](docs/testing.md) — Mock API, `sna tu` commands, `SNA_CLAUDE_COMMAND`, test modules
