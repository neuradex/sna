# @sna-sdk/react

React bindings for [SNA](https://github.com/neuradex/sna) — hooks, components, and a drop-in chat UI for talking to the SNA server.

## Install

```bash
npm install @sna-sdk/react @sna-sdk/core
```

### Peer dependencies

- `react` >= 18
- `zustand` >= 4
- `@radix-ui/react-tooltip` (only for `<SnaChatUI>`)

## Provider setup

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";

<SnaProvider snaUrl={sna.baseUrl} authToken={sna.authToken}>
  <YourApp />
</SnaProvider>
```

`SnaProvider` is a pure context provider — no UI, no peer deps beyond React. It auto-discovers the server URL via `/api/sna-port` if `snaUrl` is omitted; otherwise falls back to `http://localhost:3099`.

| Prop | |
|------|---|
| `snaUrl?` | Override the server URL |
| `authToken?` | Bearer token returned by `startSnaServer` |
| `sessionId?` | Default session id (default `"default"`) |
| `hydrate?` | Hydrate chat-store on mount (default `true`) |

## Drop-in chat UI

```tsx
import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";

<SnaProvider snaUrl={sna.baseUrl} authToken={sna.authToken}>
  <SnaChatUI dangerouslySkipPermissions>
    <YourApp />
  </SnaChatUI>
</SnaProvider>
```

`<SnaChatUI>` ships message bubbles, tool-use cards, collapsible thinking blocks, markdown rendering, and a permission dialog — wired to a session via context.

| Prop | |
|------|---|
| `defaultOpen?` | Open chat panel on first visit (default `false`) |
| `dangerouslySkipPermissions?` | Skip Claude permission prompts (default `false`) |

## Multi-session scoping

```tsx
import { SnaSession } from "@sna-sdk/react/components/sna-session";

<SnaProvider snaUrl={sna.baseUrl} authToken={sna.authToken}>
  <SnaSession id="default"><HelperAgent /></SnaSession>
  <SnaSession id={activeProjectSessionId}><ChatArea /></SnaSession>
</SnaProvider>
```

`SnaSession` overrides `sessionId` for all descendant hooks. Useful for multi-project IDEs or split panes.

## Hooks

```tsx
import {
  useAgent,
  useSessionManager,
  useResponsiveChat,
} from "@sna-sdk/react/hooks";
```

### `useAgent`

Subscribe to the agent event stream and send messages.

```tsx
const { connected, alive, start, send, kill, completion } = useAgent({
  sessionId: "default",
  provider: "claude-code",
  reasoningLevel: 3,                            // 0..5; omit to use the provider default
  providerOptions: { serviceTier: "priority" }, // Codex-only; Claude ignores
  onAssistant:  (e) => append(e.message),
  onToolResult: (e) => attach(e.data),
  onComplete:   () => setBusy(false),
  onError:      (e) => toast.error(e.message),
});
```

- `start(prompt?)` — POST `/agent/start` for the bound session
- `send(message)` — POST `/agent/send`
- `kill()` — POST `/agent/kill`
- `completion({ prompt, model?, systemPrompt?, reasoningLevel?, providerOptions? })` — POST `/agent/completion`. Per-call `reasoningLevel` overrides the hook-level one; otherwise the hook default applies.

`reasoningLevel` (0..5) is provider-agnostic and translates to Claude's
`--effort` or Codex's `model_reasoning_effort`. See the table in
[`@sna-sdk/client`'s README](../client/README.md#latency-knobs) for the
mapping. `providerOptions.serviceTier` is intentionally Codex-only
(mirrors Codex's `/fast` slash command); Claude's `/fast` is a
different model variant with its own billing pool, so it's not
auto-translated — set `model` directly there if you want Claude's fast
variant.

### `useSessionManager`

CRUD for sessions, with polling refresh.

```tsx
const { sessions, loading, createSession, killSession, deleteSession, refresh } =
  useSessionManager();

const handleNew = async () => {
  const id = await createSession({
    label: "loom-1",
    cwd: "/path/to/project",
    meta: { app: "loom" },
  });
};
```

### `useResponsiveChat`

Returns `{ mode }` where `mode` is one of:

- `"side-by-side"` — desktop (≥1024px), chat panel beside main content
- `"overlay"` — tablet (768–1023px), chat slides over content
- `"fullscreen"` — mobile (<768px), chat covers the viewport

## Exports

| Import path | Contents |
|-------------|----------|
| `@sna-sdk/react/components/sna-provider`  | `SnaProvider` |
| `@sna-sdk/react/components/sna-session`   | `SnaSession` |
| `@sna-sdk/react/components/sna-chat-ui`   | `SnaChatUI` |
| `@sna-sdk/react/components/chat`          | `ChatPanel`, `ChatHeader`, `ChatInput`, `MessageBubble`, etc. |
| `@sna-sdk/react/hooks`                    | `useAgent`, `useSessionManager`, `useResponsiveChat`, … |
| `@sna-sdk/react/stores/chat-store`        | `useChatStore` (Zustand) |
| `@sna-sdk/react/context`                  | `SnaContext`, `useSnaContext` |

## Documentation

- [Architecture](https://github.com/neuradex/sna/blob/main/docs/architecture.md)
- [App Setup](https://github.com/neuradex/sna/blob/main/docs/app-setup.md)

## License

MIT
