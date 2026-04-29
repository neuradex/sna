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
  onLog: (line) => console.log("[sna]", line),
});
// sna.port    — actual port (may differ from `port` if 0 was passed)
// sna.process — forked ChildProcess
// sna.stop()  — graceful SIGTERM
```

For Electron, swap to `@sna-sdk/core/electron` and add `asarUnpack: ["node_modules/@sna-sdk/core/**"]` to electron-builder. The Electron launcher additionally locates the consumer app's electron-rebuilt `better-sqlite3` and threads the binding path through.

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
await sna.agent.interrupt(sessionId);
await sna.agent.restart(sessionId);  // same lastStartConfig
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
