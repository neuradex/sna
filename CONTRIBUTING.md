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
- `chat_sessions` — session management (main + background)
- `chat_messages` — chat history persistence
- `skill_events` — skill execution state tracking (FK → chat_sessions)

Application DB (`data/<app>.db`):
- App-specific tables only
- Applications MUST NOT define `skill_events`, `chat_sessions`, or `chat_messages`

#### Event Pipeline

All owned by `@sna-sdk/core`:

```
emit.js → sna.db → /events (SSE) → useSkillEvents hook → UI
```

`emit.js` is context-aware:
- `SNA_SESSION_ID` env var present → writes to `sna.db` with session FK
- `SNA_SESSION_ID` absent → console output only (no DB write)

#### Import Paths

- Server/DB/CLI: `@sna-sdk/core/*`
- React hooks/components/stores: `@sna-sdk/react/*`
- NEVER import from `sna/` (legacy package name)

### Tech Stack

- TypeScript (strict) + Hono + better-sqlite3 + React 19
- tsup (library bundler) + pnpm 10
- Tailwind CSS v4 + Zustand + Radix UI (tooltip)

### Key Files

| File | Role |
|------|------|
| `packages/core/src/db/schema.ts` | SDK database (sna.db) — chat_sessions, chat_messages, skill_events |
| `packages/core/src/scripts/emit.ts` | Context-aware CLI event emitter |
| `packages/core/src/scripts/hook.ts` | Permission request hook |
| `packages/core/src/scripts/sna.ts` | Lifecycle CLI (api:up, api:down, gen client) |
| `packages/core/src/scripts/gen-client.ts` | Typed client code generator |
| `packages/core/src/lib/skill-parser.ts` | SKILL.md frontmatter parser |
| `packages/core/src/server/index.ts` | createSnaApp() Hono factory |
| `packages/core/src/server/routes/chat.ts` | Chat persistence CRUD routes |
| `packages/react/src/hooks/use-skill-events.ts` | SSE subscription hook |
| `packages/react/src/hooks/use-sna.ts` | Main hook (runSkill, runSkillInBackground) |
| `packages/react/src/hooks/use-sna-client.ts` | Typed client hook (useSnaClient) |
| `packages/react/src/components/sna-provider.tsx` | Root React provider |

### Documentation

- [Architecture](docs/architecture.md) — DB separation, event pipeline, package structure
- [Skill Authoring](docs/skill-authoring.md) — How to write skills with typed args
- [App Setup](docs/app-setup.md) — Frontend, server, Vite configuration, typed client
- [Design Decisions](docs/design-decisions.md) — DB scope, locking, invoked status
