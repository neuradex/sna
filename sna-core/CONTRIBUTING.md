## Design Principles

### Consumer apps should not know SNA internals

SNA core must be a black box. Consumer apps interact only through:

- `<SnaProvider>` — single React wrapper, no route mounting
- `sna api:up` / `sna api:down` — CLI commands for lifecycle

Consumer apps should **never** need to:
- Know which port the SNA API server uses (3099)
- Kill orphan processes manually
- Mount Hono routes or configure CORS
- Handle agent process cleanup

If a consumer app has to implement infrastructure logic, it belongs in sna-core.

### Lifecycle management is sna-core's responsibility

`sna api:up`:
- Healthcheck port 3099 (verify it's an SNA server, not something else)
- Reuse if already running, spawn if not
- Spawn Claude Code agent before accepting requests

`sna api:down`:
- SIGTERM with graceful wait (up to 3 seconds)
- SIGKILL if the process doesn't exit
- Port cleanup as a fallback (kill any remaining process on 3099)
- PID file cleanup

Consumer's `stop` command only calls `sna api:down` — nothing else needed.

### Process cleanup must be bulletproof

The shutdown sequence:
1. `shuttingDown` flag prevents re-entrant shutdown
2. Kill Claude Code agent (SIGTERM)
3. Close HTTP server
4. Force exit after 3s timeout (`.unref()` so it doesn't block)
5. Suppress `uncaughtException` during shutdown (e.g. IPC channel closed by tsx)

`api:down` adds another layer:
1. Send SIGTERM to the server PID
2. Poll `isProcessRunning()` for up to 3 seconds
3. SIGKILL if still alive
4. `lsof -ti:3099 | xargs kill -9` as a final sweep
5. Clear PID file

### SSE connections are a scarce resource

Chrome limits HTTP/1.1 to **6 connections per origin**. SSE connections are persistent and consume slots. Rules:

- Never open duplicate SSE connections for the same data
- `useSkillEvents` has an `enabled` flag — disable when another component handles the same events
- When the agent restarts, **don't reset `eventCounter`** — SSE cursors depend on monotonic IDs
- Keep total SSE connections to 2 max (skill events + agent events)

### Claude Code stream-json format

Claude Code with `--output-format stream-json --input-format stream-json` emits events per **content block completion**, not per token:

```
system (init) → assistant (thinking) → assistant (text) → assistant (tool_use) → user (tool_result) → result
```

There are no `content_block_delta` events. Token-level streaming is not available through this interface. UI uses typewriter animation to compensate.

### Chat UI conventions

- **User messages**: bubble with background/border
- **Agent messages**: no background, no border (text only)
- **Tool calls, thinking, skill cards**: compact inline, collapsible, indented results
- **Status/cost info**: embedded in agent message footer, not separate messages
- **Typewriter animation**: only for newly received messages, stripped from persistence (`animate` flag excluded from `partialize`)
- **Auto-scroll**: MutationObserver on the scroll container, not tied to message count

### Default model

The default model is `claude-sonnet-4-6`. Set via `SNA_MODEL` env var or the header dropdown (which kills and restarts the agent).
