# SNA — Agentic CLI Runtimes as a Backend Runtime

**An HTTP/WebSocket server that wraps Claude Code, Codex, OpenCode, Grok Build, and Cursor as background processes, so consumer apps can use them as a backend runtime.**

```
Your app → @sna-sdk/client → SNA server → spawn(agentic CLI runtime) → events back over WS
```

The SDK normalizes those runtimes into a single API surface: one canonical conversation model, one event protocol, one permission flow, one set of runtime controls. Consumer apps don't need to know which agent is running underneath, and a session can switch runtimes mid-conversation without losing context.

## Packages

| Package | npm name | Role |
|---------|----------|------|
| `packages/core` | `@sna-sdk/core` | HTTP/WS server, session manager, runtime adapters, canonical history, SQLite, launchers |
| `packages/client` | `@sna-sdk/client` | TypeScript client. Dual transport (HTTP for ordering, WS for push). Framework-agnostic. |
| `packages/react` | `@sna-sdk/react` | React bindings — hooks (`useAgent`, `useSessionManager`, `useResponsiveChat`) and a drop-in chat UI |
| `packages/testing` | `@sna-sdk/testing` | Mock Anthropic Messages API + `sna-test` CLI for running Claude Code in an isolated test env |

## Version stability

SNA is still in the `0.x.x` line, so public APIs and runtime behavior may
change between minor releases while the SDK settles. If you use SNA in an
app, pin exact package versions in `package.json` instead of relying on a
floating range.

```bash
pnpm add @sna-sdk/core@0.17.2 @sna-sdk/client@0.17.2
pnpm add @sna-sdk/react@0.17.2
```

If you find a bug or have a feature request, please open an issue:
https://github.com/neuradex/sna/issues

## What the SDK gives you

- **Multi-session agents.** `POST /agent/sessions` creates a session record; `POST /agent/start?session=<id>` spawns the selected runtime subprocess for it. Call them again with a new id and you get another. Each session has its own cwd, meta, event buffer, lifecycle, and a `runtimeChain` of `RuntimeSession` rows recording every config mutation.
- **Canonical conversation model.** Messages are stored as flat blocks with two orthogonal axes: `actor` (`user`/`assistant`/`system`) and `kind` (`text`/`thinking`/`tool_use`/`tool_result`/`status`/`error`). Binaries live in an `embeds` JSON keyed by id; content text holds inline `![](embed://<id>)` refs. Provider-native formats (Anthropic content arrays, Codex ResponseItems) are derived on demand.
- **Session continuity without cache plumbing.** Keep sending to the same session and SNA keeps the active runtime-native conversation/thread attached. On restart or explicit resume, SNA falls back to the canonical history adapters. Apps do not implement history reload, prompt replay, or cache-key setup just to continue a conversation, and runtimes can keep using their own vendor-side cache behavior where available.
- **3-layer attribution.** `provider` (runtime: claude-code / codex), `modelProvider` (vendor: anthropic / openai / google), `model` (slug). Lets you swap runtimes or models mid-session and keep accurate per-row attribution.
- **Real-time events over WebSocket.** 15 normalized event types: `init`, `thinking` / `thinking_delta`, `text_delta`, `assistant` / `assistant_delta`, `tool_use` / `tool_use_delta`, `tool_result`, `permission_needed`, `milestone`, `user_message`, `interrupted`, `error`, `complete`. The `_delta` events stream tokens for ChatGPT-style UIs.
- **Unified permission flow.** Claude Code's PreToolUse hook and Codex's JSON-RPC bidirectional approval are abstracted behind one `permission.subscribe` / `respondPermission` API. Safe-tool allowlists work for both providers.
- **Runtime control without restart.** `agent.set-model`, `agent.set-permission-mode`, `agent.interrupt`. `agent.restart` brings the process back with the same config. `agent.resume` rebuilds provider-native history from canonical blocks and feeds it back in.
- **One-shot completion.** `completion()` skips session management for short single-prompt jobs (e.g. naming a chat). Returns `{ text, usage, costUsd, durationMs, model }`. Opportunistically reuses a pooled daemon if one is already alive for the cwd, so high-frequency autocomplete-style callers don't pay per-call cold-start. Pass `onDelta` for typewriter-style streaming.
- **Streaming one-shot runs.** `runOnce()` exposes the full agent pipeline (tool calls, thinking, permissions) for a temp session. In-process callers can pass `onDelta` / `onEvent` callbacks; network callers can subscribe to `POST /agent/run-once/stream` (SSE), wrapped client-side as `client.agent.runOnceStream(opts)` returning `AsyncIterable<AgentEvent>`.
- **Reasoning effort knob.** A provider-agnostic `reasoningLevel: 0..5` flows to Claude Code's `--effort` and Codex's `model_reasoning_effort` / `turn/start.effort`. Set 0 for autocomplete-grade latency, 5 for deep thinking.
- **Codex runtime knobs.** `providerOptions.serviceTier` mirrors Codex's `/fast` slash command (values: `"priority"`, `"flex"`, `"batch"`), `providerOptions.profile` maps to `--profile`, and `providerOptions.config` maps to repeatable `-c key=value` overrides. Use `providerOptions.config` for OpenAI-compatible gateways such as OpenRouter or local model servers by configuring Codex's native `model_providers.*` settings. Codex-only on purpose — Claude's `/fast` is a different MODEL variant with its own billing pool, so it's not auto-translated.
- **Hooks / MCP / policy abstraction.** Define hooks, MCP servers, allowed/disallowed tools once; per-provider adapters apply them. Mid-session provider switches keep the same configuration.
- **Embedded launchers.** `startSnaServer({ port, dbPath, runtimePaths, ... })` starts a host-owned child server. `startSnaDaemon(...)` starts a detached background server, writes pid/log files under `.sna`, and can adopt an already healthy SNA daemon on the same port.

## Quick start

### As a consumer app

```ts
import { resolveClaudeCli, startSnaServer } from "@sna-sdk/core/node";
import { SnaClient } from "@sna-sdk/client";

const claude = resolveClaudeCli();
if (claude.source === "fallback") {
  throw new Error("Claude Code CLI was not found. Install it or pass runtimePaths.claudeCode.");
}

const sna = await startSnaServer({
  appId: "my-app",
  port: 3099,
  dbPath: "./data/sna.db",
  runtimePaths: {
    claudeCode: claude.path,
  },
});

const client = new SnaClient(sna.connection);
client.connect();

const { sessionId } = await client.sessions.create({ label: "research" });
await client.agent.start(sessionId, { provider: "claude-code", model: "claude-sonnet-4-6" });

let unsubscribe = () => {};
const done = new Promise<void>((resolve, reject) => {
  let streamed = false;
  unsubscribe = client.agent.onEvent(({ event, isHistory }) => {
    if (isHistory) return;
    if (event.type === "assistant_delta") {
      streamed = true;
      process.stdout.write(event.delta ?? "");
    }
    if (event.type === "assistant" && event.message && !streamed) process.stdout.write(event.message);
    if (event.type === "complete") resolve();
    if (event.type === "error") reject(new Error(event.message ?? "Agent error"));
  });
});
await client.agent.subscribe(sessionId);

await client.agent.send(sessionId, "What's in this directory?");
await done;

unsubscribe();
client.disconnect();
sna.stop();
```

> Launchers bind to `127.0.0.1` by default, generate an auth token, and tag sessions with `appId`. SDK clients should pass the returned `sna.connection` object instead of handling the token separately. Protected HTTP and SSE routes use `Authorization: Bearer <authToken>`, and browser WebSocket upgrades use `/ws?token=<authToken>`. Direct standalone server usage is intended for development/debugging and must set `SNA_AUTH_TOKEN` explicitly.

For desktop apps that want SNA to keep running after the launcher process
returns, use the daemon launcher:

```ts
import { startSnaDaemon } from "@sna-sdk/core/node";

const sna = await startSnaDaemon({
  port: 3099,
  dbPath: "./data/sna.db",
  runtimePaths: {
    claudeCode: claude.path,
  },
});

console.log(`SNA daemon pid=${sna.pid}, log=${sna.logPath}`);
console.log(`SNA daemon admin=${sna.adminUrl}`);
await sna.openAdmin();
```

`startSnaDaemon()` stores `.sna/sna-daemon.pid`, `.sna/sna-daemon.log`,
`.sna/sna-api.port`, and `.sna/sna-api.token`. If another healthy SNA daemon
is already serving the requested port, the launcher adopts it and `stop()`
returns `false` instead of killing a process it does not own.

The daemon also serves a local admin shell at `/admin`. `sna.adminUrl` is the
plain URL, while `sna.openAdmin()` opens the default browser with a one-time
token URL fragment; the page stores that token in browser localStorage and
removes it from the address bar before calling protected same-origin APIs.

Optional encrypted daemon storage is available with
`database: { encryption: "sqlite-cipher", keyProvider: { type: "keytar" } }`.
The consumer app installs `better-sqlite3-multiple-ciphers` and, for the
default keychain-backed provider, `keytar`; `keytar` stores a generated DB key
in the OS credential store, while `env`, `raw`, and `custom` providers cover
other deployment models.

> The running server publishes its own live OpenAPI 3.1 spec — open `http://localhost:3099/docs` for Swagger UI, `http://localhost:3099/openapi.json` for the raw JSON, or `http://localhost:3099/spec` for a plain-text view.

### As a React app

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";

<SnaProvider connection={sna.connection}>
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
