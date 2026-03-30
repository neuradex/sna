---
description: Sync all documentation files with the current codebase state. Run this after any architectural change, package restructure, or convention update.
---

## Sync Docs

Update all documentation to reflect the current state of the codebase. Code is always the source of truth.

### Steps

1. **Discover source files** — Scan the codebase dynamically (DO NOT use a hardcoded list):
   - `packages/core/src/**/*.ts` — all core source files
   - `packages/react/src/**/*.tsx` and `packages/react/src/**/*.ts` — all react source files
   - `packages/core/package.json` and `packages/react/package.json` — exports, scripts, dependencies
   - `pnpm-workspace.yaml` — workspace structure
   - `plugins/**/*.md` and `plugins/**/*.json` — plugin definitions

   From these, extract current facts:
   - DB schema (table names, columns, paths)
   - CLI commands (sna.ts command router)
   - API routes (all Hono route definitions)
   - Exported functions, hooks, components (index.ts, package.json exports)
   - Event types (dispatch.ts SEND_TYPES, close types)
   - File paths that are referenced in configs (hook script, emit script)
   - Component/hook props and signatures

2. **Discover documentation files** — Find all `.md` files that may reference code (DO NOT use a hardcoded list):
   ```
   **/*.md excluding node_modules/, dist/, .sna/, samples/
   ```
   This includes: README.md, CONTRIBUTING.md, docs/*.md, CLAUDE.md, plugins/**/*.md, packages/*/README.md

3. **Compare and update** — For each discovered .md file:
   - Read the file
   - Identify all code references (paths, function names, CLI commands, API routes, event types, props, etc.)
   - Compare each reference against the actual code state from step 1
   - If a reference is stale, update it to match reality
   - If a referenced file/function/route no longer exists, remove or replace the reference

4. **Verify cross-file consistency** — After individual updates, check that these values are identical across ALL .md files:
   - DB paths and table names
   - Package names and import paths
   - Event types list
   - CLI command names and syntax
   - Script paths (emit, hook, dispatch)
   - SDK server endpoints
   - Component/hook names and signatures

5. **Language rule** — All documentation MUST be written in English.

6. **Report** — List which files were updated, what changed, and any references that couldn't be resolved (possible dead docs).
