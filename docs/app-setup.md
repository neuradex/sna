## App Setup Guide

There are two integration shapes:

1. **Embed the server inside your app** — the recommended path. Use `startSnaServer()` from `@sna-sdk/core/node` or `@sna-sdk/core/electron`, then connect with `SnaClient` (any framework) or `@sna-sdk/react` hooks.
2. **Run the server standalone** — point your client at an externally managed SNA server (`http://host:port`).

### Install

```bash
npm install @sna-sdk/core @sna-sdk/client            # Any framework
npm install @sna-sdk/core @sna-sdk/client @sna-sdk/react  # React
```

`@sna-sdk/core` has `better-sqlite3` and `langfuse` as peer dependencies. `@sna-sdk/react` peers React 18+, Zustand, and `@radix-ui/react-tooltip`.

### Embedding the server

```ts
import { startSnaServer } from "@sna-sdk/core/node";

const sna = await startSnaServer({
  port: 3099,
  dbPath: "./data/sna.db",
  maxSessions: 20,
  permissionMode: "acceptEdits",
  runtimePaths: {
    claudeCode: "/opt/homebrew/bin/claude",
  },
  onLog: (line) => console.log("[sna]", line),
});
// sna.port    — actual port (may differ from `port` if 0 was passed)
// sna.process — forked ChildProcess
// sna.stop()  — graceful SIGTERM
```

For Electron, swap to `@sna-sdk/core/electron` and add `asarUnpack: ["node_modules/@sna-sdk/core/**"]` to electron-builder. The Electron launcher additionally locates the consumer app's electron-rebuilt `better-sqlite3` and threads the binding path through. Store user-selected runtime CLI paths in your app settings and pass them through `runtimePaths`.

### Connecting from any framework

```ts
import { SnaClient } from "@sna-sdk/client";

const sna = new SnaClient({
  baseUrl: "localhost:3099",
  ws: true,    // real-time push
  http: true,  // ordering guarantees on state-changing ops
});

sna.sessions.onSnapshot((sessions) => updateSessionList(sessions));
sna.connect();

const { sessionId } = await sna.sessions.create({ label: "research" });
await sna.agent.start(sessionId, {
  provider: "claude-code",
  model: "claude-sonnet-4-6",
});

sna.agent.onEvent(({ event }) => {
  if (event.type === "assistant_delta") streamToken(event.delta);
  if (event.type === "assistant") commitMessage(event.message);
  if (event.type === "tool_use") showToolCall(event.data);
});
await sna.agent.subscribe(sessionId);

await sna.agent.send(sessionId, "What's in this directory?");
```

> The running server publishes its own live OpenAPI 3.1 spec — open `http://localhost:3099/docs` for Swagger UI, `http://localhost:3099/openapi.json` for the raw JSON, or `http://localhost:3099/spec` for a plain-text view.

`http: true` means each Promise resolves only after the server has committed the state change — safe to chain `sessions.create` → `agent.start` → `agent.send` without polling. Pure-WS mode (`http: false`) ACKs immediately and gives no ordering guarantees; use it only for read-only or fire-and-forget flows.

#### Permission handling

```ts
sna.agent.onPermissionRequest(({ session, request }) => {
  showDialog(request, (approved) => sna.agent.respondPermission(session, approved));
});
await sna.agent.subscribePermissions();
```

#### Runtime control

```ts
await sna.agent.setModel(sessionId, "claude-haiku-4-5");
await sna.agent.setPermissionMode(sessionId, "bypassPermissions");
await sna.agent.update(sessionId, { cwd: "/path/to/proj-b" });   // unified PATCH
await sna.agent.interrupt(sessionId);
await sna.agent.restart(sessionId);  // re-uses Session.config
await sna.agent.resume(sessionId);   // rebuild from canonical history
```

#### One-shot completion

```ts
const { text, usage, costUsd } = await sna.agent.completion({
  prompt: "Summarize this in one sentence: ...",
  model: "claude-haiku-4-5",
  label: "summarizer",
});
```

For latency-sensitive callers (autocomplete, naming a chat) you can pin
the reasoning effort low and — on Codex — opt into the request-priority
lane that mirrors the `/fast` slash command:

```ts
await sna.agent.completion({
  prompt: "...",
  provider: "codex",
  model: "gpt-5.4-mini",
  reasoningLevel: 0,                            // → Codex: `none`, Claude: `low`
  providerOptions: { serviceTier: "priority" }, // Codex-only: `/fast` equivalent
});
```

`reasoningLevel` is a provider-agnostic 0..5 scale (lightest → heaviest)
that maps to `--effort` on Claude and `model_reasoning_effort` on Codex.
`providerOptions.serviceTier` is intentionally Codex-only — Claude's
`/fast` is a different model variant billed against its own usage pool,
so set Claude's `model` directly when you want its fast variant.

If `completion()` is called frequently against the same `cwd`, the
provider opportunistically reuses any pooled daemon already alive for
that cwd, sparing the per-call cold-start cost. Provision the pool once
(e.g. on app boot via `getRuntimePool().prepare(...)` from
`@sna-sdk/core`) for fastest subsequent calls.

To stream the assistant text as it's produced — useful for inline
autocomplete previews or typewriter rendering — call `completion()`
directly from `@sna-sdk/core` (the in-process API) with an `onDelta`
callback. The Promise still resolves with the final concatenated text,
so it's purely additive:

```ts
import { completion } from "@sna-sdk/core";

await completion({
  prompt: "Draft a commit message for: ...",
  onDelta: (chunk) => stdoutWriter.write(chunk),
});
```

`onDelta` is a local callback and so can't traverse the HTTP/WS client —
it only applies when you import `completion` directly inside the
process that owns the SNA server (e.g. the embedded launcher or a
custom integration). Wired for `claude-code` and `codex` (both pool and
ephemeral paths); on OpenCode the SDK call is single-shot, so the
callback is a documented no-op for now.

For network consumers, `runOnce` exposes the same idea over Server-Sent
Events. Each event in the underlying agent pipeline (assistant_delta,
tool_use, complete, ...) flows through; the connection closes after the
run's terminal event.

```ts
for await (const event of sna.agent.runOnceStream({
  message: "Draft a commit message for: ...",
})) {
  if (event.type === "assistant_delta") {
    stdoutWriter.write(event.delta as string);
  } else if (event.type === "complete") {
    console.log("usage", event.data);
  }
}
```

In-process callers of `runOnce()` from `@sna-sdk/core` can pass an
`onDelta` (text only) or `onEvent` (full event stream) callback for the
same effect without an HTTP hop. `runOnceStream` requires `http: true`
on the client.

### React integration

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";

<SnaProvider snaUrl="http://localhost:3099">
  <YourApp />
</SnaProvider>
```

`SnaProvider` is a pure context provider — no UI, no peer deps beyond React. Auto-discovers the server URL via `/api/sna-port` if `snaUrl` is omitted; otherwise falls back to `http://localhost:3099`.

#### Drop-in chat UI

```tsx
import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";

<SnaProvider snaUrl={apiUrl}>
  <SnaChatUI dangerouslySkipPermissions>
    <YourApp />
  </SnaChatUI>
</SnaProvider>
```

`SnaChatUI` ships message bubbles, tool-use cards, collapsible thinking blocks, markdown rendering, and a permission dialog — wired to a session via context. Requires `@radix-ui/react-tooltip` and `zustand` as peer deps.

#### Multi-session scoping

```tsx
import { SnaSession } from "@sna-sdk/react/components/sna-session";

<SnaProvider snaUrl={apiUrl}>
  <SnaSession id="default"><HelperAgent /></SnaSession>
  <SnaSession id={activeProjectSessionId}><ChatArea /></SnaSession>
</SnaProvider>
```

`SnaSession` overrides `sessionId` for all descendant hooks. Useful for multi-project IDEs and split panes.

#### Hooks

```tsx
import { useAgent, useSessionManager } from "@sna-sdk/react/hooks";

function Chat() {
  const { connected, alive, start, send, kill } = useAgent({
    onAssistant: (e) => append(e.message),
    onToolResult: (e) => attach(e.data),
    onComplete: () => setBusy(false),
  });
}

function SessionList() {
  const {
    sessions, loading, createSession, killSession, deleteSession, refresh,
  } = useSessionManager();

  const newProject = () =>
    createSession({ label: "loom-1", cwd: "/path/to/project", meta: { app: "loom" } });
}
```

Set `meta.app = "<your-app>"` on creation to filter sessions when multiple apps share one SNA server. `SNA_MAX_SESSIONS` caps the number of concurrently alive subprocesses (default 5).

### Workspace dev

When working inside this monorepo, use `link:` references and tell Vite to resolve the source condition:

```json
{
  "dependencies": {
    "@sna-sdk/core":   "link:../sna/packages/core",
    "@sna-sdk/client": "link:../sna/packages/client",
    "@sna-sdk/react":  "link:../sna/packages/react"
  }
}
```

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    conditions: ["source"],
    dedupe: ["react", "react-dom", "@radix-ui/react-tooltip"],
  },
  optimizeDeps: {
    exclude: ["@sna-sdk/core", "@sna-sdk/client", "@sna-sdk/react"],
  },
});
```
