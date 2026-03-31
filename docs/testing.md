## Testing Guide

### Overview

SNA SDK provides a mock Anthropic API server and test utilities for running tests without real API calls or affecting user accounts.

```
Real flow:     Claude Code → api.anthropic.com → real LLM → response
Test flow:     Claude Code → localhost:mock    → reversed text → response
```

### Test Utilities (`sna tu`)

```bash
sna tu api:up       # Start mock Anthropic API server (random port)
sna tu api:down     # Stop mock API server
sna tu api:log      # Show request/response log
sna tu api:log -f   # Follow log in real-time (tail -f)
sna tu claude ...   # Run claude with mock API env vars
```

#### Quick Start

```bash
# 1. Start mock server
sna tu api:up
# → Mock Anthropic API → http://localhost:56208 (log: .sna/mock-api.log)

# 2. Run claude against mock
sna tu claude -p "hello world"
# → dlrow olleh

# 3. Check what Claude Code sent to the API
sna tu api:log
# [16:01:50.438] REQ model=test-mock stream=true messages=1 user="hello world"
# [16:01:50.448] RES stream complete reply="dlrow olleh"

# 4. Cleanup
sna tu api:down
```

#### How It Works

`sna tu claude` wraps the real `claude` binary with:

| Env Var | Value | Purpose |
|---------|-------|---------|
| `ANTHROPIC_BASE_URL` | `http://localhost:<mock-port>` | Redirect API calls to mock |
| `ANTHROPIC_API_KEY` | `sk-test-mock-sna` | Fake API key (no real auth) |
| `CLAUDE_CONFIG_DIR` | `.sna/mock-claude-config/` | Isolated config (no OAuth, no user data) |

No other env vars from the parent process are passed. This prevents:
- OAuth token conflicts (`Auth conflict` warning)
- User account pollution (session history, analytics)
- Accidental real API calls

#### Mock API Behavior

The mock server echoes user text **reversed**:
- `"hello world"` → `"dlrow olleh"`
- `"SNA SDK 테스트"` → `"트스테 KDS ANS"`

This makes test assertions deterministic and easy to verify.

The mock implements the Anthropic Messages API streaming format:
- `POST /v1/messages` with `stream: true`
- SSE events: `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop`

#### Log Format

`.sna/mock-api.log` records every request and response:

```
[16:01:50.438] POST /v1/messages?beta=true application/json
[16:01:50.447] REQ model=test-mock stream=true messages=1 user="hello world"
[16:01:50.448] RES stream complete reply="dlrow olleh"
```

### `SNA_CLAUDE_COMMAND` Environment Variable

Override the claude binary used by the SDK. This is how tests swap in `sna tu claude` instead of the real `claude`.

```bash
# Default: SDK resolves claude from .sna/claude-path, known paths, or $PATH
# Override:
export SNA_CLAUDE_COMMAND="node --import tsx src/scripts/sna.ts tu claude"
```

Resolution order in `ClaudeCodeProvider`:
1. `SNA_CLAUDE_COMMAND` env var (highest priority)
2. `.sna/claude-path` cached file
3. Known paths (`/opt/homebrew/bin/claude`, etc.)
4. `which claude`

Supports multi-word commands — split on whitespace, first word is the binary, rest are prefix args.

### Running Tests

```bash
cd packages/core

# All tests (101 tests, 7 modules)
pnpm test

# Individual modules
node --import tsx --test test/session-manager.test.ts
node --import tsx --test test/db-schema.test.ts
node --import tsx --test test/normalize-event.test.ts
node --import tsx --test test/api-routes.test.ts
node --import tsx --test test/api-parity.test.ts
node --import tsx --test test/ws-handler.test.ts
node --import tsx --test test/agent-integration.test.ts

# With coverage
node --import tsx --experimental-test-coverage --test test/**/*.test.ts
```

### Test Modules

| Module | Tests | What It Covers |
|--------|-------|----------------|
| `session-manager` | 16 | Session CRUD, config persistence, CASCADE safety, pub/sub |
| `db-schema` | 8 | Tables, columns, indexes, migration, CASCADE behavior |
| `normalize-event` | 9 | init/interrupted/error event parsing from Claude Code |
| `api-routes` | 22 | All HTTP endpoints via Hono test client |
| `api-parity` | 5 | HTTP/WS operation key match, typed helper usage |
| `ws-handler` | 33 | All WS message types with real WS server + client |
| `agent-integration` | 8 | Real Claude Code + mock API E2E pipeline |

### Writing Integration Tests

Use `startMockAnthropicServer()` from the SDK:

```typescript
import { startMockAnthropicServer } from "@sna-sdk/core/testing";

const mock = await startMockAnthropicServer();
// mock.port — server port
// mock.requests — array of received requests
// mock.close() — shutdown

// Set env before spawning claude
process.env.ANTHROPIC_BASE_URL = `http://localhost:${mock.port}`;
process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.CLAUDE_CONFIG_DIR = "/tmp/isolated-config";
```

Or use `sna tu` commands for manual testing:

```bash
sna tu api:up
sna tu claude -p --model claude-haiku-4-5-20251001 "your prompt"
sna tu api:log
sna tu api:down
```

### CI Considerations

- `agent-integration` tests require the `claude` binary installed
- If `claude` is not found, integration tests are **skipped** (not failed)
- All other tests (93 of 101) run without `claude` installed
- Mock API server uses random ports — no port conflicts in parallel runs
- Each test module uses its own temp DB directory — no state leakage
