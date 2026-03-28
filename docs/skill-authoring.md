## Skill Authoring Guide

### Skill Location

Skills live in the application's `.claude/skills/<name>/SKILL.md`.

### Basic Structure

```markdown
---
description: What this skill does (used by Claude to decide when to invoke)
---

## Instructions

1. Do something
2. Emit events at each step
3. Report results
```

### Emitting Events (REQUIRED)

Every skill that performs work MUST emit events using the SDK script:

```bash
# Start
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type start --message "Starting..."

# Progress/Milestone
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type milestone --message "Step 1 complete"

# Complete
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type complete --message "Done. Summary here"

# Error (on failure)
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type error --message "Failed: reason"
```

**Important:**
- Use `node node_modules/@sna-sdk/core/dist/scripts/emit.js` — NOT `tsx scripts/emit.ts`
- The `--skill` name should match the skill folder name
- `complete` triggers automatic frontend data refresh
- Always emit `start` at the beginning and `complete` or `error` at the end

### Event Data

Pass structured data with `--data`:

```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type complete \
  --message "Processed 5 items" \
  --data '{"count": 5, "duration_ms": 1200}'
```

### Reading App Data

Skills run TypeScript scripts via `tsx` that can access the app's database:

```bash
tsx scripts/my-script.ts --arg value
```

These scripts import the app's `getDb()` for app-specific data. They use the SDK's emit script for events.

### Skill Template

```markdown
---
description: Brief description for Claude
---

## <Skill Name>

### Steps

1. Emit start event:
   ```bash
   node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type start --message "Starting..."
   ```

2. Do the actual work (run scripts, read/write data)

3. Emit milestone for each significant step:
   ```bash
   node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type milestone --message "Step done: <detail>"
   ```

4. Emit complete or error:
   ```bash
   node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type complete --message "Done. <summary>"
   ```
```
