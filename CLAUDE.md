# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is SNA?

Skills-Native Application — a platform where **Claude Code is the runtime**, not an external LLM API.

```
Traditional:  your code → LLM API → parse → act
SNA:          SKILL.md → Claude Code → scripts → SQLite → SSE → UI
```

## Repository Structure

```
sna/
├── packages/
│   ├── core/    (@sna-sdk/core)  — Server runtime, DB, CLI, event pipeline
│   └── react/   (@sna-sdk/react) — React hooks, components, stores
├── docs/                          — SDK documentation (source of truth)
├── plugins/sna-builder/           — Claude Code plugin for SNA development
├── .claude-plugin/marketplace.json — Plugin marketplace definition
└── pnpm-workspace.yaml
```

## Commands

```bash
# Build packages
cd packages/core && pnpm build
cd packages/react && pnpm build

# Install dependencies
pnpm install
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for full details.

### DB Separation (CRITICAL)

- `data/sna.db` — SDK-owned (`skill_events` only)
- `data/<app>.db` — Application-owned (app-specific tables)
- Applications MUST NOT define `skill_events` in their own DB

### Event Pipeline

All owned by `@sna-sdk/core`:

```
emit.js → sna.db → /events (SSE) → useSkillEvents hook → UI
```

Skills emit events via:
```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type <type> --message "<text>"
```

### Import Paths

- Server/DB/CLI: `@sna-sdk/core/*`
- React hooks/components/stores: `@sna-sdk/react/*`
- NEVER import from `sna/` (legacy package name)

## Tech Stack

- TypeScript (strict) + Hono + better-sqlite3 + React 19
- tsup (library bundler) + pnpm 10
- Tailwind CSS v4 + Zustand

## Key Files

| File | Role |
|------|------|
| `packages/core/src/db/schema.ts` | SDK database (sna.db) + skill_events schema |
| `packages/core/src/scripts/emit.ts` | CLI event emitter |
| `packages/core/src/scripts/hook.ts` | Permission request hook |
| `packages/core/src/scripts/sna.ts` | Lifecycle CLI (api:up, api:down) |
| `packages/core/src/server/index.ts` | createSnaApp() Hono factory |
| `packages/react/src/hooks/use-skill-events.ts` | SSE subscription hook |
| `packages/react/src/components/sna-provider.tsx` | Root React provider |
