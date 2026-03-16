# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a monorepo with three packages:

- **`skills-native-app/`** — The main SNA demo application (primary work target)
- **`sna-site/`** — Marketing/documentation website
- **`start-sna-app/`** — CLI tool (`npx start-sna-app`) that scaffolds a new SNA project from the `skills-native-app/` template

Most development work happens inside `skills-native-app/`.

## What is SNA (Skills-Native Application)?

The core innovation: **Claude Code is the runtime, not an external LLM API.**

```
Traditional:  your code → LLM API → parse → act
SNA:          SKILL.md → Claude Code → scripts → SQLite
```

Skills are markdown files (`.claude/skills/<name>/SKILL.md`) that instruct Claude Code to run TypeScript scripts, reason over results, and emit real-time events to the frontend.

## Commands (run from `skills-native-app/`)

```bash
pnpm sna:up        # Full startup: install → DB init → WS server → Next.js
pnpm sna:down      # Stop all services
pnpm sna:status    # Show running services
pnpm sna:restart   # Restart services

pnpm dev           # Next.js dev server only (localhost:3000)
pnpm build         # Production build
pnpm lint          # ESLint

pnpm db:init       # Initialize + seed SQLite database

# Emit a skill event (used inside skill scripts)
tsx src/scripts/emit.ts --skill <name> --type <type> --message "<text>"

# Collect git history
tsx src/scripts/devlog.ts collect|stats|export
```

## Architecture

### Data Flow

1. User invokes a skill (`/devlog-collect`) in the embedded Claude Code terminal
2. Claude Code reads the skill's `SKILL.md` and executes TypeScript scripts via `tsx`
3. Scripts read/write to SQLite (`data/devlog.db`)
4. Scripts emit events via `tsx src/scripts/emit.ts` → stored in `skill_events` table
5. Frontend polls `/api/events` (SSE) → `useSkillEvents()` hook → real-time UI updates
6. `complete` events trigger automatic dashboard data refresh

### Key Directories

```
skills-native-app/
├── .claude/
│   ├── CLAUDE.md              # Project-specific Claude instructions (more detailed)
│   └── skills/                # Skill definitions (SKILL.md files)
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Landing page
│   │   ├── devlog/page.tsx    # Dashboard
│   │   └── api/
│   │       ├── devlog/        # GET dashboard data
│   │       ├── events/        # SSE stream of skill events
│   │       ├── emit/          # POST skill events
│   │       └── run/           # POST execute commands
│   ├── db/schema.ts           # SQLite schema + getDb() (single source of truth)
│   ├── scripts/               # CLI scripts called by skills
│   │   ├── sna.ts             # Lifecycle manager
│   │   ├── emit.ts            # Event emission
│   │   └── devlog.ts          # Git history collector
│   ├── components/terminal/   # xterm.js wrapper + panel UI
│   ├── hooks/
│   │   └── use-skill-events.ts  # Subscribe to SSE stream
│   └── server/terminal.ts     # WebSocket terminal server (node-pty)
├── data/                      # SQLite files (git-ignored)
├── .sna/                      # Runtime state: PIDs, port, logs (git-ignored)
```

### SQLite Tables

- `commits` — git commit history
- `analysis_notes` — Claude's saved insights (shown on dashboard)
- `skill_events` — real-time event log (polled by `/api/events` SSE)

### Real-Time Event Protocol

Every skill must emit events using this pattern:

```bash
tsx src/scripts/emit.ts --skill <name> --type start --message "Starting..."
tsx src/scripts/emit.ts --skill <name> --type milestone --message "Step done: <result>"
tsx src/scripts/emit.ts --skill <name> --type complete --message "Done. <summary>"
# or on failure:
tsx src/scripts/emit.ts --skill <name> --type error --message "Failed: <reason>"
```

Event types: `start`, `progress`, `milestone`, `complete`, `error`

The `complete` event triggers automatic frontend data refresh.

### Terminal in Browser

A **bottom drawer** embeds real Claude Code via xterm.js + node-pty + WebSocket (port 3001). This is not mocked — users run actual skills here.

The drawer bar is always visible at the bottom (36px). Clicking it or dragging up expands it. Clicking outside the drawer closes it.

**Required setup in consumer apps:**
- `<SnaProvider>` wraps the entire app in `layout.tsx`
- `<TerminalSpacer />` goes at the bottom of every scrollable content container (prevents content from being hidden behind the bar)

```tsx
// app/layout.tsx
import { SnaProvider } from "sna/components/sna-provider";
// ...
<SnaProvider>{children}</SnaProvider>

// any page/layout with a scroll container
import { TerminalSpacer } from "sna/components/terminal-spacer";
// ...
<main className="overflow-auto">
  {children}
  <TerminalSpacer />
</main>
```

## Tech Stack

- Next.js 16 App Router + React 19 (TypeScript strict)
- better-sqlite3 (local SQLite, no cloud DB)
- xterm.js + node-pty + WebSocket (embedded terminal)
- Zustand (terminal panel state, locale)
- Tailwind CSS v4
- pnpm 10 (package manager)
- tsx (TypeScript script executor)

Path alias: `@/*` → `src/*`

## Important Notes

- The `.claude/CLAUDE.md` inside `skills-native-app/` has more detailed skill authoring instructions — read it when writing or modifying skills.
- Runtime state (PIDs, logs) lives in `.sna/` — check there if services misbehave.
- The `data/` directory is git-ignored; run `pnpm db:init` to initialize a fresh database.
