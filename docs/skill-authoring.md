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

### Emitting Events with `sna dispatch` (Recommended)

`sna dispatch` is the recommended way to emit skill events. It validates the skill name, manages dispatch sessions, and handles both the DB write and console output.

#### CLI Usage

The CLI follows an `open` / `send` / `close` lifecycle:

```bash
# 1. Open a dispatch session (validates skill, prints session ID)
ID=$(sna dispatch open --skill my-skill)

# 2. Send events during execution
sna dispatch $ID called --message "Skill invoked"
sna dispatch $ID start --message "Starting..."
sna dispatch $ID milestone --message "Step 1 complete"
sna dispatch $ID progress --message "Processing item 3/10"

# 3. Close the session (emits complete + kills background session)
sna dispatch $ID close --message "Done. Summary here"

# Or close with error
sna dispatch $ID close --error "Failed: reason"
```

Valid send types: `called`, `start`, `progress`, `milestone`, `permission_needed`

#### Programmatic Usage

Use `createDispatchHandle` for a chainable API in TypeScript scripts:

```typescript
import { createDispatchHandle } from "@sna-sdk/core";

const h = createDispatchHandle({ skill: "my-skill" });

h.called("Skill invoked");
h.start("Starting...");
h.milestone("Step 1 complete");
h.progress("Processing item 3/10");
await h.close();                          // success
await h.close({ error: "Failed: reason" }); // error
```

Individual functions are also exported:

```typescript
import { dispatchOpen, dispatchSend, dispatchClose } from "@sna-sdk/core";

const { id } = dispatchOpen({ skill: "my-skill" });
dispatchSend(id, { type: "start", message: "Starting..." });
await dispatchClose(id, { message: "Done" });
```

**Important:**
- `sna dispatch open` validates the skill name against `.sna/skills.json` (falls back to checking SKILL.md existence)
- `close` emits both canonical (`complete`/`error`) and legacy (`success`/`failed`) event types for backward compatibility
- `close` also notifies the SNA API server to kill the background session
- When `SNA_SESSION_ID` is set (SDK-managed sessions), events are written to the DB with the session FK

### Emitting Events with `emit.js` (Legacy/Deprecated)

> **Note:** `emit.js` is deprecated in favor of `sna dispatch`. It remains available for backward compatibility but new skills should use `sna dispatch`.

```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type start --message "Starting..."

node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill my-skill --type complete --message "Done."
```

- `emit.js` is context-aware: writes to DB only when `SNA_SESSION_ID` is set
- Event types: `start`, `progress`, `milestone`, `complete`, `error`

### Event Data

Pass structured data with `--data`:

```bash
# With sna dispatch
sna dispatch $ID milestone --message "Processed 5 items" --data '{"count": 5}'

# With emit.js (legacy)
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

1. Open dispatch session and emit start:
   ```bash
   ID=$(sna dispatch open --skill <name>)
   sna dispatch $ID start --message "Starting..."
   ```

2. Do the actual work (run scripts, read/write data)

3. Emit milestone for each significant step:
   ```bash
   sna dispatch $ID milestone --message "Step done: <detail>"
   ```

4. Close the dispatch session:
   ```bash
   sna dispatch $ID close --message "Done. <summary>"
   ```
```
