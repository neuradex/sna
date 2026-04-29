# SNA — Claude Code & Codex as a Backend Runtime

**An HTTP/WebSocket server that wraps Claude Code and Codex as background processes, so consumer apps can use them as a backend runtime.**

```
Your app → @sna-sdk/client → SNA server → spawn(claude-code | codex) → events back over WS
```

The SDK normalizes both runtimes into a single API surface: one canonical conversation model, one event protocol, one permission flow, one set of runtime controls. Consumer apps don't need to know which agent is running underneath, and a session can switch providers mid-conversation without losing context.

## Packages

| Package | npm name | Role |
|---------|----------|------|
| `packages/core` | `@sna-sdk/core` | HTTP/WS server, session manager, providers (Claude Code, Codex), canonical history, SQLite, launchers |
| `packages/client` | `@sna-sdk/client` | TypeScript client. Dual transport (HTTP for ordering, WS for push). Framework-agnostic. |
| `packages/react` | `@sna-sdk/react` | React bindings — hooks (`useAgent`, `useSessionManager`, `useSnaClient`, …) and a drop-in chat UI |
| `packages/testing` | `@sna-sdk/testing` | Mock Anthropic Messages API + `sna-test` CLI for running Claude Code in an isolated test env |

## What the SDK gives you

- **Multi-session agents.** `POST /agent/create` spawns a Claude Code or Codex subprocess. Call it again and you get another. Each session has its own cwd, meta, event buffer, and lifecycle.
- **Canonical conversation model.** Messages are stored as flat blocks with two orthogonal axes: `actor` (`user`/`assistant`/`system`) and `kind` (`text`/`thinking`/`tool_use`/`tool_result`/`status`/`error`). Binaries live in an `embeds` JSON keyed by id; content text holds inline `![](embed://<id>)` refs. Provider-native formats (Anthropic content arrays, Codex ResponseItems) are derived on demand.
- **3-layer attribution.** `provider` (runtime: claude-code / codex), `modelProvider` (vendor: anthropic / openai / google), `model` (slug). Lets you swap runtimes or models mid-session and keep accurate per-row attribution.
- **Real-time events over WebSocket.** 12 normalized event types: `init`, `thinking` / `thinking_delta`, `assistant` / `assistant_delta`, `tool_use`, `tool_result`, `permission_needed`, `milestone`, `user_message`, `interrupted`, `error`, `complete`. The `_delta` events stream tokens for ChatGPT-style UIs.
- **Unified permission flow.** Claude Code's PreToolUse hook and Codex's JSON-RPC bidirectional approval are abstracted behind one `permission.subscribe` / `respondPermission` API. Safe-tool allowlists work for both providers.
- **Runtime control without restart.** `agent.set-model`, `agent.set-permission-mode`, `agent.interrupt`. `agent.restart` brings the process back with the same config. `agent.resume` rebuilds provider-native history from canonical blocks and feeds it back in.
- **One-shot completion.** `completion()` skips session management for short single-prompt jobs (e.g. naming a chat). Returns `{ text, usage, costUsd, durationMs, model }`.
- **Hooks / MCP / policy abstraction.** Define hooks, MCP servers, allowed/disallowed tools once; per-provider adapters apply them. Mid-session provider switches keep the same configuration.
- **Embedded launcher.** `startSnaServer({ port, dbPath, ... })` from `@sna-sdk/core/electron` or `@sna-sdk/core/node` forks the standalone server, resolves native bindings (asar-aware), and waits for ready.

## Quick start

### As a consumer app

```ts
import { startSnaServer } from "@sna-sdk/core/node";
import { SnaClient } from "@sna-sdk/client";

const sna = await startSnaServer({ port: 3099, dbPath: "./data/sna.db" });

const client = new SnaClient({ baseUrl: "localhost:3099", ws: true, http: true });
client.connect();

const { sessionId } = await client.sessions.create({ label: "research" });
await client.agent.start(sessionId, { provider: "claude-code", model: "claude-sonnet-4-6" });

client.agent.onEvent(({ event }) => {
  if (event.type === "assistant") console.log(event.message);
});
await client.agent.subscribe(sessionId);

await client.agent.send(sessionId, "What's in this directory?");
```

### As a React app

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";

<SnaProvider snaUrl="http://localhost:3099">
  <SnaChatUI dangerouslySkipPermissions>
    <YourApp />
  </SnaChatUI>
</SnaProvider>
```

The bundled `<SnaChatUI>` gives you a chat panel with message bubbles, tool-call cards, collapsible thinking blocks, markdown rendering, and a permission dialog — wired to a session via context.

### Building the workspace

```bash
pnpm install
pnpm -r build
```

## Documentation

| Document | Contents |
|----------|----------|
| [Architecture](docs/architecture.md) | Server, session manager, canonical history, providers, permission flow |
| [App Setup](docs/app-setup.md) | Embedding the server, connecting via `SnaClient`, React integration |
| [Design Decisions](docs/design-decisions.md) | Why canonical-flat blocks, 3-layer attribution, dual transport |
| [Testing](docs/testing.md) | Mock Anthropic API, `sna-test` CLI, isolated Claude Code instances |
| [Contributing](CONTRIBUTING.md) | Repository layout, key files, tech stack |
| [About SNA](about-sna.md) | The story behind the project |

## License

MIT
