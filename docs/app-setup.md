## Application Setup Guide

### Dependencies

```json
{
  "dependencies": {
    "@sna-sdk/core": "link:../sna/packages/core",
    "@sna-sdk/react": "link:../sna/packages/react",
    "@radix-ui/react-tooltip": "^1.2.0"
  }
}
```

For published versions, use npm versions instead of `link:`.

### Frontend Setup

#### SnaProvider

`SnaProvider` is a pure context provider with no UI and no peer dependencies beyond React. Wrap your app with it to enable SDK context:

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";

function App() {
  return (
    <SnaProvider>
      {children}
    </SnaProvider>
  );
}
```

Props:
- `children` — React children
- `snaUrl?` — Override SDK server URL (auto-discovered by default)
- `sessionId?` — Session ID for this provider scope (default: `"default"`)

#### SnaChatUI

For the built-in chat panel with agent auto-start, use `SnaChatUI` inside `SnaProvider`. This is a separate component with its own peer dependency (`@radix-ui/react-tooltip`):

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { SnaChatUI } from "@sna-sdk/react/components/sna-chat-ui";

function App() {
  return (
    <SnaProvider>
      <SnaChatUI dangerouslySkipPermissions>
        {children}
      </SnaChatUI>
    </SnaProvider>
  );
}
```

Props:
- `children` — React children
- `defaultOpen?` — Open chat panel on first visit (default: `false`)
- `dangerouslySkipPermissions?` — Skip Claude permission prompts (default: `false`)

#### Multi-Session with SnaSession

For apps managing multiple projects or agent sessions (e.g., Electron multi-project IDEs), use `SnaSession` to scope which session child hooks use:

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { SnaSession } from "@sna-sdk/react/components/sna-session";

function App() {
  return (
    <SnaProvider snaUrl={apiUrl}>
      {/* Helper agent — always available */}
      <SnaSession id="default">
        <HelperAgent />
      </SnaSession>

      {/* Active project — switches with user selection */}
      <SnaSession id={activeProjectSessionId}>
        <ChatArea />
      </SnaSession>
    </SnaProvider>
  );
}
```

- `SnaSession` overrides the `sessionId` in context — all descendant `useAgent()` / `useSna()` calls automatically use it
- Without `SnaSession`, hooks default to `"default"`
- Existing single-session apps need no changes

Create sessions with different `cwd` values for multi-project support:

```typescript
import { useSessionManager } from "@sna-sdk/react/hooks";

const { createSession } = useSessionManager();

// Each project gets its own session with a specific working directory
const sessionId = await createSession({
  label: "my-project",
  cwd: "/path/to/project",
  meta: { app: "my-app" },  // optional: identify sessions by app
});
```

Set `SNA_MAX_SESSIONS` environment variable when starting the SNA API server to allow more concurrent sessions (default: 5).

#### Typed Client (Recommended)

Generate a typed client from your SKILL.md files:

```bash
sna gen client --out src/sna-client.ts
```

Use with `useSnaClient`:

```tsx
import { useSnaClient } from "@sna-sdk/react/hooks";
import { bindSkills } from "@/src/sna-client";

function MyComponent() {
  const { skills, events } = useSnaClient({ bindSkills });

  // Type-safe — args are checked at compile time
  const handleClick = async () => {
    try {
      const result = await skills.formFill({ sessionId: 123 });
      console.log("Done:", result.message);
    } catch (err) {
      console.error("Failed:", err.message);
    }
  };
}
```

Skills run in background sessions — the main chat stays free for conversation.

Regenerate the client after adding or changing skills:

```bash
sna gen client --out src/sna-client.ts
```

#### useSkillEvents Hook

Subscribe to real-time skill events (lower-level):

```tsx
import { useSkillEvents } from "@sna-sdk/react/hooks";

function StatusBar() {
  const { events, connected, isRunning } = useSkillEvents({
    onComplete: (event) => mutate("/api/data"),
  });
}
```

### Server Setup

#### App-specific API routes

Your Hono/Express server handles app-specific routes only:

```ts
import { Hono } from "hono";
import { snaPortRoute } from "@sna-sdk/core/server";

const app = new Hono();
app.route("/api/targets", targetsRoutes);
app.route("/api/sessions", sessionsRoutes);

// Required: SnaProvider calls this to discover the SDK server
app.get("/api/sna-port", snaPortRoute);
```

**Do NOT create `/api/events` or `/api/emit` routes.** These are served by the SDK standalone server.

#### Lifecycle Script

Use `scripts/sna.ts` to start the SDK server alongside your app:

```ts
const SNA_CLI = path.join(ROOT, "node_modules/@sna-sdk/core/dist/scripts/sna.js");
execSync(`node "${SNA_CLI}" api:up`, { stdio: "inherit", cwd: ROOT });
```

### Database Setup

Your app manages its own database. Do NOT include SDK tables:

```ts
function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (...);
    CREATE TABLE IF NOT EXISTS sessions (...);
    -- NO skill_events, chat_sessions, or chat_messages here
    -- Those are in data/sna.db (SDK-managed)
  `);
}
```

### Claude Code Settings

The PreToolUse hook is auto-injected by the SDK when spawning agents via `--settings`. The hook script path is resolved via `import.meta.url` (works with pnpm link / monorepo setups). You do NOT need to manually configure `.claude/settings.json` for the hook — the SDK handles it.

If you need to add custom hooks, pass them via `extraArgs` in the agent start options. The SDK merges your hooks with its own.

### Vite Config (for source-level dev)

```ts
export default defineConfig({
  resolve: {
    conditions: ["source"],
    dedupe: ["react", "react-dom", "@radix-ui/react-tooltip"],
  },
  server: {
    fs: {
      allow: [".", path.resolve(__dirname, "..")],
    },
  },
  optimizeDeps: {
    exclude: ["@sna-sdk/core", "@sna-sdk/react"],
  },
});
```

- `conditions: ["source"]` — resolves SDK source files directly, no build needed during dev
- `dedupe` — prevents duplicate React instances when using `link:` packages
- `exclude` — prevents Vite from pre-bundling linked SDK packages
