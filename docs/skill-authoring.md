## Skill Authoring Guide

### Skill Location

Skills live in the application's `.claude/skills/<name>/SKILL.md`.

### Basic Structure

```markdown
---
description: What this skill does (used by Claude to decide when to invoke)
sna:
  args:
    paramName:
      type: number
      required: true
      description: What this parameter is
---

## Instructions

1. Do something
2. Emit events at each step
3. Report results
```

### Typed Arguments (`sna.args`)

Define skill arguments in frontmatter under `sna.args`. This enables typed client generation via `sna gen client`.

```yaml
---
description: Fill a form for a session
sna:
  args:
    sessionId:
      type: number
      required: true
      description: Session ID to fill
    verbose:
      type: boolean
---
```

**Supported types:** `string`, `number`, `boolean`, `string[]`, `number[]`

Frontmatter is stripped before the skill content is passed to Claude — it does NOT consume context window tokens.

After adding or changing `sna.args`, regenerate the client:

```bash
sna gen client --out src/sna-client.ts
```

### Emitting Events

Skills emit events using the SDK script:

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
- `emit.js` is context-aware: writes to DB only when `SNA_SESSION_ID` is set (SDK-managed sessions)

### Event Data

Pass structured data with `--data`:

```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type complete \
  --message "Processed 5 items" \
  --data '{"count": 5, "duration_ms": 1200}'
```

### Skill Template

```markdown
---
description: Brief description for Claude
sna:
  args:
    id:
      type: number
      required: true
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
