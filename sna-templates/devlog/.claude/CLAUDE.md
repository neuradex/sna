# Skills-Native Application (SNA) — CLAUDE.md

This project is a **template and demo** for the Skills-Native Application architecture.
You are running as the AI runtime for this app. Skills are in `.claude/skills/`.

---

## Core Principles

### 1. Claude Code IS the runtime
No external LLM API calls. Claude Code reads SKILL.md files and executes them directly.
The right panel (xterm.js + node-pty + WebSocket) embeds Claude Code in the web UI.

### 2. Skills are the logic layer
All AI behavior is defined in `.claude/skills/<name>/SKILL.md`.
Skills instruct Claude to run TypeScript scripts, reason over results, and emit events.

### 3. SQLite is the data layer
All persistence is local SQLite (`data/devlog.db`).
No cloud DB, no network dependency for data. Scripts read/write directly.

### 4. Skill Event Protocol (IMPORTANT)
**Every SNA skill that performs agentic work MUST emit events at key milestones.**
This is how the frontend knows what's happening in real-time.

#### Emit events using:
```bash
tsx src/scripts/emit.ts --skill <name> --type <type> --message "<text>" [--data '<json>']
```

#### Event types and when to use them:
| Type | When |
|------|------|
| `start` | First thing a skill does |
| `progress` | Incremental updates inside loops |
| `milestone` | Significant checkpoint (e.g., "Repo X: 12 commits found") |
| `complete` | Skill finished successfully — **frontend auto-refreshes data on this** |
| `error` | Something failed — emit before returning error to user |

#### Rule: Every skill must emit at minimum:
1. `start` — at the beginning
2. At least one `milestone` per meaningful step
3. `complete` or `error` — always at the end

#### Example skeleton for any skill:
```bash
# 1. Start
tsx src/scripts/emit.ts --skill my-skill --type start --message "Starting..."

# 2. Do work in steps, emit milestones
tsx src/scripts/emit.ts --skill my-skill --type milestone --message "Step 1 done: <result>"

# 3. Finish
tsx src/scripts/emit.ts --skill my-skill --type complete --message "Done. <summary>"
```

#### Why this matters:
- Skills are agentic and can take minutes
- Without events, the user sees nothing until the skill finishes
- The frontend subscribes via SSE (`/api/events`) and updates the UI in real-time
- `complete` events trigger automatic data refresh on the dashboard

### 5. sna up / sna down are the lifecycle
`/sna-up` starts everything: DB init, WS terminal server, Next.js.
`/sna-down` stops everything cleanly.
Non-engineers can clone and run `/sna-up` with zero configuration.

---

## Skills available

| Skill | What it does |
|-------|-------------|
| `/sna-up` | Start full environment (install → DB → WS server → Next.js) |
| `/sna-down` | Stop all services |
| `/devlog-collect` | Scan git repos, save commits, emit milestones per repo |
| `/devlog-analyze` | Analyze patterns, emit insights as milestones |
| `/devlog-report` | Generate weekly/monthly report |

---

## Tech stack

- Next.js 16 App Router (TypeScript)
- better-sqlite3 (local SQLite at `data/devlog.db`)
- xterm.js + node-pty + WebSocket (real Claude Code terminal in right panel)
- Zustand (terminal panel state)
- Tailwind CSS v4
- pnpm

## Key commands

```bash
pnpm sna:up       # Start full environment
pnpm sna:down     # Stop all services
pnpm sna:status   # Show what's running
pnpm db:init      # Initialize + seed database

tsx src/scripts/emit.ts --skill <name> --type <type> --message "<text>"
tsx src/scripts/devlog.ts collect|stats|export
```

## DB tables

- `commits` — git commit history
- `analysis_notes` — Claude's saved insights (shown on dashboard)
- `skill_events` — real-time event log (polled by /api/events SSE)

## Runtime state (.sna/, git-ignored)

- `next.pid` — Next.js process PID
- `terminal.pid` — WebSocket terminal server PID
- `port` — web server port
- `next.log` — Next.js stdout/stderr
- `terminal.log` — WS server stdout/stderr
