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

Wrap your app with `SnaProvider`:

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";

function App() {
  return (
    <SnaProvider dangerouslySkipPermissions>
      {children}
    </SnaProvider>
  );
}
```

Props:
- `snaUrl` — Override SDK server URL (auto-discovered by default)
- `defaultOpen` — Open chat panel on first visit
- `dangerouslySkipPermissions` — Skip Claude permission prompts
- `headless` — Context only, no built-in UI

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

#### .claude/settings.json

```json
{
  "hooks": {
    "PermissionRequest": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR\"/node_modules/@sna-sdk/core/dist/scripts/hook.js",
        "async": true
      }]
    }]
  }
}
```

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
