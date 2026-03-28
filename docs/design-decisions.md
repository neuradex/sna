## Design Decisions

### Prisma as the DB layer (planned)

SNA will adopt Prisma as the standard database layer for applications.

**Rationale:**
- The SDK needs to understand application schema for skill execution locking
- Prisma schema files are declarative and machine-readable
- Relationships between models are explicit, enabling automatic dependency inference
- Migration management comes for free
- Widely adopted — minimal learning curve for developers

**How it works:**
- Applications define their schema in `prisma/schema.prisma`
- `sna init` generates the DB and runs migrations
- SDK reads the schema to understand table structure and relations
- No raw SQL for schema management

### Skill execution locking (planned)

Multi-session skill execution requires mutual exclusion when skills operate on related data.

**Problem:**
- `template-edit` modifies a template while `form-analyze` reads that template's data
- `form-fill session:123` and `form-submit session:123` should not run concurrently
- Different sessions (e.g., session:123 vs session:456) can run in parallel
- Locking at the table level is too coarse — row-level locking is needed

**Design:**
- Each skill declares which Prisma model it targets in SKILL.md
- The skill argument maps to the model's primary key
- SDK reads the Prisma schema to resolve relations between models
- Before execution, SDK checks for conflicting locks by traversing relations

**Example:**

```prisma
// prisma/schema.prisma
model Template {
  id       Int       @id @default(autoincrement())
  name     String
  sessions Session[]
}

model Session {
  id          Int      @id @default(autoincrement())
  template_id Int
  template    Template @relation(fields: [template_id], references: [id])
}
```

```yaml
# form-fill/SKILL.md frontmatter
---
description: Fill a form for a session
resource: Session
---
```

```yaml
# template-edit/SKILL.md frontmatter
---
description: Edit a template
resource: Template
---
```

When `template-edit Template:5` is running:
- SDK knows `Session` depends on `Template` via `template_id`
- Any `form-fill` targeting a Session where `template_id = 5` is blocked
- `form-fill` targeting a Session where `template_id = 3` is allowed

**Lock lifecycle:**
- Acquired: when SDK receives skill execution request (before agent spawn)
- Released: on skill completion, error, or session death
- Stale lock cleanup: on process startup

**Opt-in:** Skills without a `resource` declaration run without locking (backward compatible).

### Skill execution status (planned)

SDK should record an `invoked` event in `skill_events` immediately when a skill execution is requested, before the agent process starts.

**Current flow:**
```
User clicks → /agent/start → Claude boots → emit.js --type start → UI updates
                              (seconds of silence)
```

**Target flow:**
```
User clicks → /agent/start → SDK writes "invoked" → UI updates immediately → Claude boots → emit.js --type start
```

- `invoked` = request accepted, about to execute
- `start` = skill logic has begun (from emit.js inside the skill)
- These are separate phases, not duplicates
