# @sna-sdk/testing

Testing utilities for [SNA](https://github.com/neuradex/sna) — a mock Anthropic Messages API and the `sna-test` CLI for running Claude Code in an isolated environment.

## Install

```bash
npm install --save-dev @sna-sdk/testing
```

## Why

Real LLM calls in CI burn budget. The mock implements the Anthropic Messages API streaming SSE format, so Claude Code can't tell it apart from production. Set `ANTHROPIC_BASE_URL` to the mock and you get deterministic, fast, cheap test runs.

The mock echoes user text **reversed**:

```
"hello world"      → "dlrow olleh"
"SNA SDK 테스트"    → "트스테 KDS ANS"
```

## `sna-test` CLI

Each invocation creates a named "instance" under `.sna/test-instances/<name>/` with its own mock server, isolated `CLAUDE_CONFIG_DIR`, and JSONL request/response log.

```bash
sna-test claude [args...]      # Launch Claude Code with mock API + isolated config
sna-test claude -p "prompt"    # Print mode (oneshot, non-interactive)
sna-test ls                    # List instances
sna-test logs <name> [-f]      # Show / follow API request/response log
sna-test rm <name|--all>       # Cleanup
```

### Why isolation matters

`sna-test claude` builds a fresh env (`PATH`, `HOME`, `SHELL`, `TERM`, `LANG` only, plus mock-specific overrides). It does NOT inherit the parent's `ANTHROPIC_API_KEY`, OAuth tokens, or `CLAUDE_CONFIG_DIR`. This prevents:

- OAuth conflicts ("Auth conflict" warnings)
- Real API calls leaking through
- Polluting your dev Claude account history / analytics

Each instance gets its own `claude-config/` with `customApiKeyResponses` pre-approved for the mock key, so the trust dialog doesn't pop up.

## Programmatic API

```ts
import { startMockAnthropicServer, runOneshot } from "@sna-sdk/testing";

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

## Exports

| Name | Role |
|------|------|
| `startMockAnthropicServer()` | Boot a mock Anthropic Messages API on a random port |
| `runOneshot(opts)` | Boot mock → run `claude -p` → capture → teardown |
| `MockServer`, `MockLogEntry` | Types |
| `generateInstanceName`, `getInstanceDir`, `listInstances`, `readInstanceMeta`, `writeInstanceMeta`, `removeInstance` | Instance helpers used by the CLI |

## License

MIT
