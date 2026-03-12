---
name: devlog-collect
description: Scan git repos and collect recent commits into SQLite. Usage: /devlog-collect
allowed-tools:
  - Bash(tsx src/scripts/devlog.ts *)
  - Bash(tsx src/scripts/emit.ts *)
  - Bash(git *)
---

# devlog-collect

Collect recent commit history from local git repositories into the local SQLite database.
Emit events at key milestones so the frontend dashboard updates in real-time.

## Steps

1. Emit called (lifecycle hook — always first):

```bash
tsx src/scripts/emit.ts --skill devlog-collect --type called --message "devlog-collect invoked"
```

2. Run the collector:

```bash
tsx src/scripts/devlog.ts collect
```

3. As repos are scanned, emit milestone events for each repo with activity:

```bash
tsx src/scripts/emit.ts --skill devlog-collect --type milestone --message "<repo-name>: <N> commits found"
```

4. On success, emit success (lifecycle hook — always last on success):

```bash
tsx src/scripts/emit.ts --skill devlog-collect --type success --message "Done. <N> new commits saved across <M> repos."
```

5. Report back to user with summary of what was collected.

## On error

Emit failed (lifecycle hook) then report to the user:

```bash
tsx src/scripts/emit.ts --skill devlog-collect --type failed --message "Failed: <reason>"
```

## Notes

- Emit events frequently enough that the user sees progress, but don't spam (1 per repo is fine)
- The frontend auto-refreshes data when it receives a `complete` event
- Duplicate commits are ignored (UNIQUE constraint on hash)
