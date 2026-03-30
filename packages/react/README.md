# @sna-sdk/react

React bindings for [Skills-Native Applications](https://github.com/neuradex/sna) — hooks, components, and stores for building SNA frontends.

## Install

```bash
npm install @sna-sdk/react @sna-sdk/core
```

### Peer dependencies

- `react` >= 18
- `zustand` >= 4

## Usage

### SnaProvider

Pure context provider. No UI, no peer dependencies beyond React:

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";

function App() {
  return (
    <SnaProvider>
      <YourApp />
    </SnaProvider>
  );
}
```

Props:
- `children` — React children
- `snaUrl?` — Override SDK server URL (auto-discovered by default)
- `sessionId?` — Session ID for this provider scope (default: `"default"`)

### SnaChatUI

Built-in chat panel with agent auto-start. Requires `@radix-ui/react-tooltip` as a peer dependency. Must be rendered inside `<SnaProvider>`:

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";

function App() {
  return (
    <SnaProvider>
      <SnaChatUI dangerouslySkipPermissions>
        <YourApp />
      </SnaChatUI>
    </SnaProvider>
  );
}
```

Props:
- `children` — React children
- `defaultOpen?` — Open chat panel on first visit (default: `false`)
- `dangerouslySkipPermissions?` — Skip Claude permission prompts (default: `false`)

### SnaSession

Scopes a session ID for all descendant SNA hooks. Useful for multi-session apps:

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { SnaSession } from "@sna-sdk/react/components/sna-session";

function App() {
  return (
    <SnaProvider snaUrl={apiUrl}>
      <SnaSession id="default"><HelperAgent /></SnaSession>
      <SnaSession id={activeProjectSessionId}><ChatArea /></SnaSession>
    </SnaProvider>
  );
}
```

Props:
- `id` — Session ID for this scope
- `children` — React children

### useSkillEvents

Subscribe to real-time skill events:

```tsx
import { useSkillEvents } from "@sna-sdk/react/hooks";

function StatusBar() {
  const { events, connected, isRunning } = useSkillEvents({
    onComplete: (event) => console.log("Skill done:", event.message),
  });

  return <div>{connected ? "Connected" : "Disconnected"}</div>;
}
```

### useAgent

Manage agent sessions — subscribe to SSE events and send messages:

```tsx
import { useAgent } from "@sna-sdk/react/hooks";

function Chat() {
  const { connected, alive, start, send, kill } = useAgent({ sessionId: "default" });
  // connected — SSE stream connected
  // alive — agent process is running
  // start(prompt?) — start the agent session
  // send(message) — send a message to the agent
  // kill() — kill the agent process
}
```

### useSessionManager

Manage multiple agent sessions via HTTP API:

```tsx
import { useSessionManager } from "@sna-sdk/react/hooks";

function SessionList() {
  const { sessions, loading, createSession, killSession, deleteSession, refresh } = useSessionManager();

  const handleCreate = async () => {
    const id = await createSession({ label: "my-project", cwd: "/path/to/project" });
  };
}
```

## Exports

| Import path | Contents |
|-------------|----------|
| `@sna-sdk/react/components/sna-provider` | `SnaProvider` |
| `@sna-sdk/react/components/sna-chat-ui` | `SnaChatUI` |
| `@sna-sdk/react/components/sna-session` | `SnaSession` |
| `@sna-sdk/react/components/chat` | `ChatPanel`, `ChatHeader`, `ChatInput`, message components |
| `@sna-sdk/react/hooks` | `useSkillEvents`, `useAgent`, `useSessionManager`, `useSna`, `useSnaClient`, `useResponsiveChat` |
| `@sna-sdk/react/stores/chat-store` | `useChatStore` (Zustand) |
| `@sna-sdk/react/context` | `SnaContext`, `useSnaContext` |

## Documentation

- [Architecture](https://github.com/neuradex/sna/blob/main/docs/architecture.md)
- [App Setup](https://github.com/neuradex/sna/blob/main/docs/app-setup.md)

## License

MIT
