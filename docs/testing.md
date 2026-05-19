## Testing Guide

### Mock Anthropic API

`@sna-sdk/testing` ships a mock Anthropic Messages API that implements the streaming SSE format. Set `ANTHROPIC_BASE_URL` to the mock and Claude Code thinks it's talking to the real API.

```
Real flow:  Claude Code → api.anthropic.com  → real LLM        → response
Test flow:  Claude Code → localhost:<mock>   → reversed text   → response
```

The mock echoes user text **reversed**:

```
"hello world"      → "dlrow olleh"
"SNA SDK 테스트"    → "트스테 KDS ANS"
```

This is deterministic, fast, and cheap — perfect for integration tests that exercise Claude Code's wire format without burning real tokens.

### `sna-test` CLI

The `@sna-sdk/testing` package exposes a `sna-test` binary for manual testing. Each invocation creates a named "instance": metadata is stored under `.sna/instances/<name>.json` and the logs + isolated `CLAUDE_CONFIG_DIR` live under `.sna/<name>/`. Each instance gets its own mock server and JSONL request/response log.

```bash
sna-test claude [args...]      # Launch Claude Code with mock API + isolated config
sna-test claude -p "prompt"    # Print mode (oneshot, non-interactive)
sna-test ls                    # List instances
sna-test logs <name> [-f]      # Show / follow API request/response log
sna-test logs <name> --api     # Same as default — explicit
sna-test rm <name|--all>       # Cleanup
```

#### Quick example

```bash
$ sna-test claude -p "hello world"
  instance:  test-2026-04-29-001
  Mock API ready on :56208

  dlrow olleh

$ sna-test logs test-2026-04-29-001
  16:01:50.438  REQ  test-mock  messages=1  stream=true
                user: hello world
  16:01:50.448  RES  test-mock  stream=true
                reply: dlrow olleh
```

#### Why isolation matters

`sna-test claude` builds a fresh env that contains only `PATH`, `HOME`, `SHELL`, `TERM`, `LANG`, and the mock-specific overrides. It does NOT inherit the parent process's `ANTHROPIC_API_KEY`, OAuth tokens, or `CLAUDE_CONFIG_DIR`. This prevents:

- OAuth conflicts ("Auth conflict" warnings)
- Real API calls leaking through
- Polluting your real Claude account history / analytics

Each instance gets its own `claude-config/` with `customApiKeyResponses` pre-approved for the mock key, so the trust dialog doesn't pop up.

### Programmatic mock server

For integration tests written in Node:

```ts
import { startMockAnthropicServer } from "@sna-sdk/testing";

const mock = await startMockAnthropicServer();
// mock.port      — server port
// mock.requests  — array of received request bodies
// mock.onLog     — JSONL log callback
// mock.close()   — shutdown

process.env.ANTHROPIC_BASE_URL = `http://localhost:${mock.port}`;
process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.CLAUDE_CONFIG_DIR = "/tmp/isolated-config";

// ...spawn Claude Code or run integration logic...

mock.close();
```

`runOneshot()` is a convenience wrapper that boots a mock, runs `claude -p`, captures the response, and tears down.

### Override the Claude binary

Set `SNA_CLAUDE_COMMAND` to point the SDK at a different binary or wrapper command. Multi-word values are split — first word is the binary, rest are prefix args.

```bash
SNA_CLAUDE_COMMAND="node --import tsx my-wrapper.ts" pnpm test
```

Resolution order in `ClaudeCodeProvider`:

1. `SNA_CLAUDE_COMMAND` env var
2. `.sna/claude-path` cached file
3. Known paths (`/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.local/bin/claude`)
4. `which claude`

### Running the SDK's own tests

```bash
cd packages/core
pnpm test
# or individual modules:
node --import tsx --test test/session-manager.test.ts
node --import tsx --test test/db-schema.test.ts
node --import tsx --test test/api-routes.test.ts
node --import tsx --test test/api-parity.test.ts
node --import tsx --test test/ws-handler.test.ts
node --import tsx --test test/agent-integration.test.ts
node --import tsx --test test/normalize-event.test.ts
node --import tsx --test test/claude-history-jsonl.test.ts
node --import tsx --test test/claude-history-injection.test.ts
node --import tsx --test test/codex-history-injection.test.ts
node --import tsx --test test/codex-provider.test.ts
node --import tsx --test test/opencode-history-injection.test.ts
node --import tsx --test test/opencode-provider.test.ts
node --import tsx --test test/opencode-complete.test.ts
node --import tsx --test test/claude-path-resolution.test.ts
```

For OpenCode, an end-to-end harness is also available:

```bash
# Requires real opencode 1.14.x on PATH and an authenticated provider.
# Skips cleanly with exit 0 if opencode isn't installed.
cd packages/core
pnpm verify:opencode
```

It exercises start/send/complete, cross-provider history prelude, runtime-pool reuse, permission round-trip, mid-turn interrupt, and graceful daemon shutdown.

`packages/client` also has its own `pnpm test`.

### CI considerations

- Integration tests that need the real `claude` binary (`agent-integration.test.ts`) skip cleanly when it isn't on `$PATH` — they don't fail.
- Mock API uses a random port per call — no port conflicts under parallel runs.
- Each test module uses its own temp DB directory — no cross-test state leakage.
- The user's environment expects sequential test execution by default; pass `--test-concurrency=1` if your runner defaults to parallel.
