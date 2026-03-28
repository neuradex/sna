---
description: Sync all documentation files with the current codebase state. Run this after any architectural change, package restructure, or convention update.
---

## Sync Docs

Update all documentation to reflect the current state of the codebase. Read the actual code first, then update docs to match.

### Sources of Truth

The **code** is always the source of truth. Docs describe the code, not the other way around.

### Steps

1. **Scan the codebase** — Read the following to understand current state:
   - `pnpm-workspace.yaml` — workspace packages
   - `packages/core/package.json` — core exports, scripts, dependencies
   - `packages/react/package.json` — react exports, scripts, dependencies
   - `packages/core/src/db/schema.ts` — DB schema and path
   - `packages/core/src/server/index.ts` — server routes and factory
   - `packages/core/src/scripts/emit.ts` — emit script interface
   - `packages/core/src/scripts/hook.ts` — hook script interface
   - `packages/core/src/scripts/sna.ts` — CLI commands
   - `packages/react/src/hooks/use-skill-events.ts` — SSE hook
   - `packages/react/src/components/sna-provider.tsx` — provider props
   - `plugins/sna-builder/.claude-plugin/plugin.json` — plugin version
   - `.claude-plugin/marketplace.json` — marketplace definition

2. **Update each doc file** — Compare current code with each doc and fix any drift:

   - **`README.md`** — Overview, design philosophy, packages table, quick start, plugin install commands. Keep it concise with links to details.
   - **`CONTRIBUTING.md`** — Repository structure, commands, architecture (DB separation, event pipeline, import paths), tech stack, key files table.
   - **`docs/architecture.md`** — Package structure table, DB separation rules, event pipeline flow, emit command syntax, event types, SDK server endpoints, hook config, app responsibilities.
   - **`docs/skill-authoring.md`** — Emit command path, event types, skill template.
   - **`docs/app-setup.md`** — Dependencies, SnaProvider props, hook usage, server setup, DB setup rules, Vite config.
   - **`CLAUDE.md`** — Keep minimal. Only project description + links to README and CONTRIBUTING.
   - **`plugins/sna-builder/agents/sna-builder.md`** — Agent instructions must match current conventions (DB path, emit path, import paths, rules).
   - **`plugins/sna-builder/skills/create-skill/SKILL.md`** — Emit command path must be current.
   - **`.claude-plugin/marketplace.json`** — Plugin description and version must match plugin.json.

3. **Verify consistency** — Check that these values are identical across all files:
   - SDK DB path (e.g. `data/sna.db`)
   - Emit script path (e.g. `node node_modules/@sna-sdk/core/dist/scripts/emit.js`)
   - Hook script path
   - Package names (`@sna-sdk/core`, `@sna-sdk/react`)
   - Event types list
   - SDK server endpoints

4. **Language rule** — All documentation MUST be written in English.

5. **Report changes** — List which files were updated and what changed.
