## Application Setup Guide

### Dependencies

```json
{
  "dependencies": {
    "@sna-sdk/core": "link:../sna/packages/core",
    "@sna-sdk/react": "link:../sna/packages/react"
  }
}
```

For published versions, use `workspace:*` or npm version.

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

#### useSkillEvents Hook

Subscribe to real-time skill events:

```tsx
import { useSkillEvents } from "@sna-sdk/react/hooks";

function MyComponent() {
  const { events, connected, isRunning } = useSkillEvents({
    onComplete: (event) => {
      // Refresh data when a skill completes
      mutate("/api/data");
    },
  });
}
```

### Server Setup

#### App-specific API routes

Your Hono/Express server handles app-specific routes only:

```ts
import { Hono } from "hono";

const app = new Hono();
app.route("/api/targets", targetsRoutes);
app.route("/api/sessions", sessionsRoutes);
// ... app routes only
```

**Do NOT create `/api/events` or `/api/emit` routes.** These are served by the SDK standalone server.

#### Lifecycle Script

Use `scripts/sna.ts` to start the SDK server alongside your app:

```ts
// Start SDK internal API server
execSync(`node "${SNA_CLI}" api:up`, { stdio: "inherit", cwd: ROOT });
```

Where `SNA_CLI` = `node_modules/@sna-sdk/core/dist/scripts/sna.js`.

### Database Setup

Your app manages its own database. Do NOT include `skill_events`:

```ts
// lib/db/index.ts
function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (...);
    CREATE TABLE IF NOT EXISTS sessions (...);
    -- NO skill_events here — that's in data/sna.db (SDK)
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
    conditions: ["source"], // Resolve SDK src/ directly, no build needed
  },
  server: {
    fs: {
      allow: [".", path.resolve(__dirname, "..")], // Allow linked packages
    },
  },
  optimizeDeps: {
    exclude: ["@sna-sdk/core", "@sna-sdk/react"],
  },
});
```

With `conditions: ["source"]`, changes to SDK source files are picked up by Vite HMR automatically. No need to run `pnpm build` in the SDK during development.
