# @sna-sdk/client

Framework-agnostic TypeScript client for the [SNA](https://github.com/neuradex/sna) server. Dual transport: HTTP for ordering guarantees on state-changing operations, WebSocket for real-time push.

## Install

```bash
npm install @sna-sdk/client
```

## Quick start

```ts
import { startSnaServer } from "@sna-sdk/core/node";
import { SnaClient } from "@sna-sdk/client";

const handle = await startSnaServer({
  appId: "my-app",
  dbPath: "./data/sna.db",
});

const sna = new SnaClient(handle.connection);

sna.sessions.onSnapshot((sessions) => updateSessionList(sessions));
sna.connect();

const { sessionId } = await sna.sessions.create({ label: "research" });
await sna.agent.start(sessionId, {
  provider: "claude-code",
  model: "claude-sonnet-4-6",
});

sna.agent.onEvent(({ event }) => {
  if (event.type === "assistant_delta") streamToken(event.delta);
  if (event.type === "assistant")       commitMessage(event.message);
  if (event.type === "tool_use")        showToolCall(event.data);
});
await sna.agent.subscribe(sessionId);

await sna.agent.send(sessionId, "What's in this directory?");
```

## Transport model

`baseUrl` accepts a bare host (`localhost:3099`) or full URL (`https://my-server.com`). The client derives:

- WS endpoint: `ws://<baseUrl>/ws` (or `wss://` for HTTPS)
- HTTP base:  `http://<baseUrl>` (or `https://`)

Protected SNA servers require a bearer token, but SDK launchers keep it paired
with the server handle. Pass `handle.connection` to `SnaClient` instead of
copying the token into app settings.

### What HTTP guarantees (`http: true`)

State-changing ops resolve only after the server has committed:

- `sessions.create` — DB row exists; safe to `agent.start` immediately
- `sessions.update` / `sessions.remove` — change is committed
- `agent.start` — process has been spawned (`process.alive === true`)
- `agent.send` — message written to stdin and persisted
- `agent.kill` / `restart` / `resume` / `interrupt` — state transition complete
- `agent.setModel` / `agent.setPermissionMode` — control message acked

### Always WebSocket (`ws: true`)

- `agent.subscribe` / `unsubscribe` — server-side subscription state
- `agent.onEvent` — per-session event push
- `sessions.onSnapshot` / `onConfigChanged` — reactive session state push
- `agent.subscribePermissions` / `onPermissionRequest` / `respondPermission`

### Pure-WS mode

```ts
new SnaClient({ ...handle.connection, ws: true, http: false });
```

Server ACKs immediately; async work may not be done when the Promise resolves. Use only for read-only or fire-and-forget flows.

## Permission handling

```ts
sna.agent.onPermissionRequest(({ session, request }) => {
  showDialog(request, (approved) => sna.agent.respondPermission(session, approved));
});
await sna.agent.subscribePermissions();
```

## Runtime control

```ts
await sna.agent.setModel(sessionId, "claude-haiku-4-5");
await sna.agent.setPermissionMode(sessionId, "bypassPermissions");
await sna.agent.update(sessionId, { cwd: "/path/to/proj-b" });  // unified PATCH
await sna.agent.interrupt(sessionId);
await sna.agent.restart(sessionId);   // re-uses the session's current config
await sna.agent.resume(sessionId);    // rebuild from canonical history
```

The `agent.update()` method is the unified mutator: pass any combination of
`{cwd, model, permissionMode}` and the SDK picks the right path per runtime
(codex per-turn override vs claude-code kill+respawn+replay). The response's
`applied` field tells you which path was taken.

## One-shot completion

```ts
const { text, usage, costUsd } = await sna.agent.completion({
  prompt: "Summarize this in one sentence: ...",
  model: "claude-haiku-4-5",
});
```

### Latency knobs

For autocomplete-style fast paths, two cross-cutting options are available:

```ts
// Provider-agnostic reasoning effort (0..5, lightest → heaviest)
await sna.agent.completion({
  prompt: "...",
  provider: "codex",
  model: "gpt-5.4-mini",
  reasoningLevel: 0,
});

// Codex-only: request-priority routing (mirrors Codex `/fast` slash command)
await sna.agent.completion({
  prompt: "...",
  provider: "codex",
  reasoningLevel: 0,
  providerOptions: { serviceTier: "priority" },
});
```

| level | Claude (`--effort`) | Codex (`model_reasoning_effort`) |
|---:|---|---|
| 0 | `low` | `none` |
| 1 | `low` | `minimal` |
| 2 | `medium` | `low` |
| 3 | `high` | `medium` |
| 4 | `xhigh` | `high` |
| 5 | `max` | `xhigh` |

`providerOptions.serviceTier` is intentionally Codex-only. Claude's
`/fast` is a different MODEL variant billed against a separate usage
pool (the CLI rejects it with "Fast mode requires extra usage billing"
when not opted in), so SNA does not auto-translate this option for
Claude — set Claude's `model` field directly when you want its fast
variant.

`completion()` also opportunistically reuses a pooled daemon when one
is already alive for the cwd, dropping per-call cold-start cost.

### Streaming one-shot runs

`runOnce()` returns the buffered final text. When you want token-by-token
streaming over the wire — typewriter UX, inline autocomplete — use
`runOnceStream` instead. It hits `POST /agent/run-once/stream` and yields
each `AgentEvent` as it's produced; the stream closes after the run's
terminal `complete` / `error`.

```ts
for await (const event of sna.agent.runOnceStream({
  message: "Draft a commit message for: ...",
})) {
  if (event.type === "assistant_delta") process.stdout.write(event.delta as string);
  if (event.type === "complete") console.log("usage", event.data);
}
```

`runOnceStream` requires `http: true` (SSE transport). The companion
in-process API is `runOnce({ onDelta, onEvent })` from `@sna-sdk/core`
when you own the server process — same wire format, no HTTP hop.

## Documentation

- [Architecture](https://github.com/neuradex/sna/blob/main/docs/architecture.md)
- [App Setup](https://github.com/neuradex/sna/blob/main/docs/app-setup.md)

## License

MIT
