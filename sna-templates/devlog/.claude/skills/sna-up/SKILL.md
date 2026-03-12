---
name: sna-up
description: Start the full SNA environment. Handles install, DB setup, and server. Usage: /sna-up
allowed-tools:
  - Bash(pnpm sna:up)
  - Bash(pnpm sna:status)
---

# sna-up

Start the full Skills-Native Application environment in one command.
This handles everything automatically — even for first-time setup.

## What it does (automatically)

1. Checks Node.js and pnpm are available
2. Installs dependencies if `node_modules` is missing
3. Initializes the SQLite database with seed data if not yet set up
4. Frees port 3000 if something else is using it
5. Starts the Next.js web server in the background
6. Opens the browser

## Steps

1. Run:

```bash
pnpm sna:up
```

2. Read the output and report to the user:
   - What steps ran (install, DB init, etc.)
   - URL of the running app
   - Any warnings or errors

3. If there's an error (Node not found, permission denied, etc.):
   - Diagnose what went wrong
   - Give the user a specific fix, not a generic suggestion

4. On success, tell the user what skills are available next:
   - `/devlog-collect` — pull in your real git history
   - `/devlog-analyze` — get coding pattern insights
   - `/sna-down` — stop when done
