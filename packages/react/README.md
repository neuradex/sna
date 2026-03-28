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

Wrap your app to enable SDK context, chat UI, and agent auto-start:

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";

function App() {
  return (
    <SnaProvider dangerouslySkipPermissions>
      <YourApp />
    </SnaProvider>
  );
}
```

Props:
- `snaUrl` — Override SDK server URL (auto-discovered by default)
- `defaultOpen` — Open chat panel on first visit
- `dangerouslySkipPermissions` — Skip Claude permission prompts
- `headless` — Context only, no built-in UI

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

Manage agent sessions:

```tsx
import { useAgent } from "@sna-sdk/react/hooks";

function Chat() {
  const { send, events, isStreaming } = useAgent({ sessionId: "default" });
  // ...
}
```

## Exports

| Import path | Contents |
|-------------|----------|
| `@sna-sdk/react/components/sna-provider` | `SnaProvider` |
| `@sna-sdk/react/components/chat` | `ChatPanel`, `ChatHeader`, `ChatInput`, message components |
| `@sna-sdk/react/hooks` | `useSkillEvents`, `useAgent`, `useSessionManager`, `useSna` |
| `@sna-sdk/react/stores/chat-store` | `useChatStore` (Zustand) |
| `@sna-sdk/react/context` | `SnaContext`, `useSnaContext` |

## Documentation

- [Architecture](https://github.com/neuradex/sna/blob/main/docs/architecture.md)
- [App Setup](https://github.com/neuradex/sna/blob/main/docs/app-setup.md)

## License

MIT
