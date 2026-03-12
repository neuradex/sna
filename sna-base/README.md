# Skills-Native Application

> Build AI-powered apps using Claude Code as your runtime. No API keys, no LLM costs, no infrastructure.

```bash
git clone https://github.com/neuradex/sna
cd skills-native-app
claude          # then type: /sna-up
```

This repo is simultaneously:
1. **A website** explaining the Skills-Native Application (SNA) concept
2. **A working demo** — a Dev Coding Tracker that collects your git history and lets Claude analyze your coding patterns

## The concept

Traditional LLM apps call an external API from your code. SNA flips this:

```
Traditional:  your code → LLM API → parse response → act
SNA:          SKILL.md → Claude Code → scripts → SQLite
```

Three components:
- **Skills** — `.claude/skills/*.md` files that tell Claude Code what to do
- **SQLite** — local data persistence via `better-sqlite3`
- **TypeScript scripts** — data collection and processing layer

Claude Code runs in the right panel of your editor. It reads the SKILL.md, executes scripts, reasons over the data, and responds. You never call an LLM API.

## Demo: Dev Coding Tracker

Collects commits from your local git repos → stores in SQLite → Claude analyzes patterns → visualized on a dashboard.

```
/devlog-collect → collects your git history
/devlog-analyze → Claude gives you coding pattern insights
/devlog-report  → generates a weekly dev report
```

## Quickstart

```bash
git clone https://github.com/neuradex/sna
cd skills-native-app
claude
```

Then in Claude Code:

```
/sna-up
```

That's it. `/sna-up` handles install, DB init, and starting the server.

## Project structure

```
skills-native-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Landing page (SNA concept website)
│   │   ├── devlog/page.tsx     # Dev Tracker dashboard
│   │   └── api/devlog/route.ts # Data API
│   ├── db/schema.ts            # SQLite schema + connection
│   └── scripts/
│       ├── devlog.ts           # CLI: collect / list / stats / export
│       └── init-db.ts          # DB init + seed
├── .claude/
│   ├── CLAUDE.md               # Project context for Claude Code
│   └── skills/
│       ├── devlog-collect/     # /devlog-collect skill
│       ├── devlog-analyze/     # /devlog-analyze skill
│       └── devlog-report/      # /devlog-report skill
└── data/                       # SQLite files (git-ignored)
```

## Adding your own skill

1. Create `.claude/skills/my-skill/SKILL.md`
2. Define what Claude should do in plain markdown
3. Use `allowed-tools` to restrict which commands Claude can run
4. Run `/my-skill` in Claude Code

```yaml
---
name: my-skill
description: What this skill does
allowed-tools:
  - Bash(tsx src/scripts/my-script.ts *)
---

# my-skill

1. Run the script:
   \`\`\`bash
   tsx src/scripts/my-script.ts analyze
   \`\`\`
2. Read the output and summarize for the user
```

## Tech stack

- Next.js 15 (App Router, TypeScript)
- better-sqlite3
- Tailwind CSS
- pnpm

## License

MIT
