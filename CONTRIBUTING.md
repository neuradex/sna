## Contributing

### Repository layout

```
sna/
├── packages/
│   ├── core/      (@sna-sdk/core)    — HTTP/WS server, providers, session manager, DB, launchers
│   ├── client/    (@sna-sdk/client)  — Framework-agnostic TS client (HTTP + WebSocket)
│   ├── react/     (@sna-sdk/react)   — React hooks, components, chat UI, Zustand stores
│   └── testing/   (@sna-sdk/testing) — Mock Anthropic API + `sna-test` CLI
├── docs/                              — SDK documentation (source of truth)
└── pnpm-workspace.yaml
```

### Commands

```bash
pnpm install                       # Install all workspaces
pnpm -r build                      # Build every package (tsup)
cd packages/core && pnpm test      # Core tests (node:test, tsx)
cd packages/client && pnpm test    # Client tests
```

### Architecture summary

See [docs/architecture.md](docs/architecture.md) for the full picture. Quick map:

#### Server (`@sna-sdk/core`)

`createSnaApp({ sessionManager })` returns an `OpenAPIHono` app exposing the full HTTP API plus its own OpenAPI 3.1 spec (`GET /openapi.json`, Swagger UI at `/docs`, plain-text viewer at `/spec`). `attachWebSocket(server, sessionManager)` mounts the WS handler on `/ws`. The standalone entry (`server/standalone.ts`) wires both up and is what the launcher API forks.

The `SessionManager` owns every running agent. Each `Session` carries a `process` (Claude Code or Codex subprocess), a per-session event buffer, the current `SessionConfig` (legacy name: `StartConfig`, kept as an alias), and metadata. Every config mutation appends a `RuntimeSession` row to the chain in `runtime_sessions`; `Session.currentRuntimeId` points at the active one. Listeners cover lifecycle, config changes, state changes, agent events, permission requests, and skill events.

Providers (`core/providers/{claude-code,codex,opencode}.ts`) implement a common `AgentProvider` interface (`spawn`, `isAvailable`). The returned `AgentProcess` exposes `send`, `interrupt`, `setModel`, `setPermissionMode`, `applyPatch`, `respondToPermission`, `kill` — translating each into the runtime's native control message. `applyPatch(patch)` is the per-field dispatch hook used by `SessionManager.applySessionPatch` / `PATCH /agent/session`: codex declares everything in-place via per-turn override params; claude-code applies model / permissionMode in-place and surfaces `cwd` as leftover so the orchestrator can drive a respawn-with-history. Codex and OpenCode are daemon-pooled (see `runtime.ts` / `RuntimeHandle`); Claude Code is stateless per-session.

#### Canonical conversation model

`db/schema.ts` stores chat blocks in `chat_messages` with two orthogonal axes:

- `actor`: `user` | `assistant` | `system`
- `kind`: `text` | `thinking` | `tool_use` | `tool_result` | `status` | `error`

Binary attachments live in `embeds` JSON keyed by id; content text holds inline `![](embed://<id>)` refs. `chat_sessions` carries `meta`, `cwd`, and `last_start_config` so a session can be restored across restarts.

`history/canonical.ts` builds canonical blocks from the DB. Provider-specific adapters in `history/{claude-code,codex,opencode}.ts` translate canonical → native wire format (Claude JSONL `--resume` file, Codex `thread/resume(history=...)` payload, OpenCode prompt-prelude parts). This is what makes a single conversation portable across providers.

#### Transports

HTTP routes (`server/routes/{agent,chat}.ts`) cover state-changing ops with ordering guarantees. The WebSocket handler (`server/ws.ts`) wraps the same operations and adds push channels (`agent.event`, `sessions.snapshot`, `permission.request`, `session.lifecycle`).

`server/api-types.ts` is the single source of truth for response shapes — both HTTP and WS use the typed helpers `httpJson` / `wsReply`, so drift between the two transports is a TypeScript error.

#### Permission flow

The PreToolUse hook (`scripts/hook.ts`) runs before every Claude Code tool call, posts the request to the running SNA server, and blocks until the UI answers. Codex's JSON-RPC approval is bridged through the same path. Both surface as `permission_needed` events; consumers respond via `permission.respond`.

`ClaudeCodeProvider.spawn` auto-injects the hook via `--settings`; consumers don't write `.claude/settings.json` themselves.

#### Launcher API

`@sna-sdk/core/electron` and `@sna-sdk/core/node` expose `startSnaServer({ port, dbPath, … })`. Both fork `dist/server/standalone.js` and resolve native modules and asar-unpacked paths. The Electron launcher additionally locates the consumer app's electron-rebuilt `better-sqlite3` and passes the binding path through.

### Key files

| File | Role |
|------|------|
| `packages/core/src/server/index.ts` | `createSnaApp()` Hono factory (delegates to `createOpenApiApp`) |
| `packages/core/src/server/routes/openapi.ts` | All HTTP routes defined with `@hono/zod-openapi`; serves Swagger UI at `/docs` and the spec at `/openapi.json` |
| `packages/core/src/server/routes/openapi-schemas.ts` | Shared Zod schemas used by `openapi.ts` |
| `packages/core/src/server/session-manager.ts` | Multi-session manager + pub/sub |
| `packages/core/src/server/ws.ts` | WebSocket handler wrapping all routes |
| `packages/core/src/server/api-types.ts` | Shared HTTP/WS response shapes |
| `packages/core/src/server/standalone.ts` | Standalone server entry (forked by launchers) |
| `packages/core/src/db/schema.ts` | Canonical SQLite schema + migrations |
| `packages/core/src/db/chat-messages.ts` | `insertChatMessage` etc. |
| `packages/core/src/history/canonical.ts` | Build canonical blocks from DB |
| `packages/core/src/history/claude-code.ts` | Canonical → Claude Code JSONL adapter |
| `packages/core/src/history/codex.ts` | Canonical → Codex thread/resume adapter |
| `packages/core/src/history/opencode.ts` | Canonical → OpenCode prompt-prelude adapter |
| `packages/core/src/core/providers/claude-code.ts` | Claude Code spawn + event normalization |
| `packages/core/src/core/providers/codex.ts` | Codex spawn + event normalization |
| `packages/core/src/core/providers/opencode.ts` | OpenCode spawn + event normalization (HTTP/SSE via `@opencode-ai/sdk`) |
| `packages/core/src/core/completion.ts` | One-shot `completion()` API |
| `packages/core/src/electron/index.ts` | `startSnaServer()` launcher (Electron-aware) |
| `packages/core/src/node/index.ts` | `startSnaServer()` launcher (plain Node) |
| `packages/core/src/scripts/hook.ts` | PreToolUse permission hook |
| `packages/client/src/sna-client.ts` | `SnaClient` (HTTP + WS) |
| `packages/react/src/components/sna-provider.tsx` | Root context provider |
| `packages/react/src/components/sna-chat-ui.tsx` | Drop-in chat panel |
| `packages/react/src/hooks/use-agent.ts` | Agent event subscription + send |
| `packages/react/src/hooks/use-session-manager.ts` | Session CRUD + polling |
| `packages/testing/src/mock-api.ts` | Mock Anthropic Messages API |
| `packages/testing/src/cli.ts` | `sna-test` CLI |

### Tech stack

- TypeScript (strict) + Hono + ws + better-sqlite3
- React 19 + Zustand + Radix UI Tooltip (peer)
- tsup (library bundler) + pnpm 10 workspaces
- node:test for tests (run via `tsx`)

### Documentation

- [Architecture](docs/architecture.md) — Server, session manager, canonical history, providers, permission flow
- [App Setup](docs/app-setup.md) — Embedding the server, connecting via `SnaClient`, React integration
- [Design Decisions](docs/design-decisions.md) — Why canonical-flat blocks, 3-layer attribution, dual transport
- [Testing](docs/testing.md) — Mock Anthropic API, `sna-test` CLI, isolated Claude Code instances
