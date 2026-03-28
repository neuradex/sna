---
description: Create a new SNA skill with proper event emission patterns. Use when the user wants to add a new skill to their SNA application.
---

## Create SNA Skill

Create a new skill following SNA conventions.

### Steps

1. Ask the user for the skill name and what it should do (use $ARGUMENTS if provided)

2. Create the skill directory and SKILL.md:
   ```
   .claude/skills/<skill-name>/SKILL.md
   ```

3. The SKILL.md MUST include event emission using the SDK script:
   ```bash
   node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type start --message "Starting..."
   node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type milestone --message "Step done"
   node node_modules/@sna-sdk/core/dist/scripts/emit.js --skill <name> --type complete --message "Done."
   ```

4. NEVER use `tsx scripts/emit.ts` — always use the SDK path above

5. If the skill needs TypeScript scripts, create them in the app's `scripts/` directory

6. Verify the skill follows all SNA conventions by reading `${CLAUDE_PLUGIN_ROOT}/docs/skill-authoring.md`
