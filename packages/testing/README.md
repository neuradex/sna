# @sna-sdk/testing

Testing utilities for [SNA](https://github.com/neuradex/sna) — mock Anthropic and OpenAI-compatible APIs plus the `sna-test` CLI for running Claude Code in an isolated environment.

## Install

```bash
npm install --save-dev @sna-sdk/testing
```

## Why

Real LLM calls in CI burn budget. The mocks implement the Anthropic Messages API and common OpenAI-compatible endpoints, so runtime integration tests can run deterministically without live model calls.

Set `ANTHROPIC_BASE_URL` to the Anthropic mock for Claude Code tests. Use the OpenAI mock for Codex-style Responses API paths, OpenAI-compatible chat completion paths, model catalog tests, or adapter tests that only need stable request/response behavior.

The mock echoes user text **reversed**:

```
"hello world"      → "dlrow olleh"
"SNA SDK 테스트"    → "트스테 KDS ANS"
```

## `sna-test` CLI

Each invocation creates a named "instance": metadata is stored under `.sna/instances/<name>.json` and the logs + isolated `CLAUDE_CONFIG_DIR` live under `.sna/<name>/`. Each instance gets its own mock server and JSONL request/response log.

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

### OpenAI-compatible mock

```ts
import { startMockOpenAIServer } from "@sna-sdk/testing";

const mock = await startMockOpenAIServer({
  models: [{ id: "gpt-5.4", owned_by: "openai" }],
  responseText: ({ endpoint, userText }) => `${endpoint}: ${userText}`,
});

const res = await fetch(`${mock.url}/v1/responses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
  body: JSON.stringify({ model: "gpt-5.4", input: "hello" }),
});

console.log(await res.json());
console.log(mock.requests[0]);
await mock.close();
```

Supported routes:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

Both chat completions and responses support non-streaming JSON and streaming SSE. By default the mock replies with the last user text reversed.

### Mock-attached real runtimes

Use mock-attached mode for high-confidence provider tests: run the real runtime
CLI, but route its model API traffic to a local mock server. This verifies the
actual CLI contract while keeping CI deterministic and offline from paid LLMs.

```ts
import {
  createClaudeMockEnv,
  createCodexMockEnv,
  createGrokMockEnv,
  createOpenCodeMockConfig,
  startMockAnthropicServer,
  startMockOpenAIServer,
} from "@sna-sdk/testing";

const anthropic = await startMockAnthropicServer();
const claudeEnv = createClaudeMockEnv({
  anthropicBaseUrl: `http://127.0.0.1:${anthropic.port}`,
});
// Run real `claude` with claudeEnv.env.

const openai = await startMockOpenAIServer();
const codexEnv = createCodexMockEnv({
  openAIBaseUrl: openai.url,
});
// Run real `codex` with codexEnv.env.

const grokEnv = createGrokMockEnv({
  openAIBaseUrl: openai.url,
});
// Pass grokEnv.env and grokEnv.providerOptions to SNA's Grok provider.

const opencodeConfig = createOpenCodeMockConfig({
  openAIBaseUrl: openai.url,
});
// Pass opencodeConfig.providerOptions to SNA's OpenCode provider.
```

When a runtime binary is not on `PATH`, set the same command override that the
provider uses in production before running the mock-attached tests:

```bash
SNA_CLAUDE_COMMAND=/absolute/path/to/claude \
SNA_CODEX_COMMAND=/absolute/path/to/codex \
SNA_GROK_COMMAND=/absolute/path/to/grok \
SNA_OPENCODE_COMMAND=/absolute/path/to/opencode \
pnpm --filter @sna-sdk/core exec tsx --test test/runtime-mock-attached.test.ts
```

### Runtime CLI fakes

Use the mock CLIs when you need to test SNA providers or consumer app launch
configuration without depending on a real Claude Code or Codex installation.

```ts
import {
  createClaudeMockEnv,
  createMockClaudeCli,
  createMockCodexExecCli,
  startMockAnthropicServer,
  startMockOpenAIServer,
} from "@sna-sdk/testing";

const anthropic = await startMockAnthropicServer();
const claude = createMockClaudeCli(anthropic);
const claudeEnv = createClaudeMockEnv({
  anthropicBaseUrl: `http://127.0.0.1:${anthropic.port}`,
  extraEnv: { LOOM_API_URL: "http://127.0.0.1:57787" },
});

process.env.SNA_CLAUDE_COMMAND = claude.command;
// pass claudeEnv.env to the provider/process under test

const openai = await startMockOpenAIServer();
const codex = createMockCodexExecCli(openai);
process.env.SNA_CODEX_COMMAND = codex.command;

// ...run provider or app integration logic...

claude.close();
codex.close();
anthropic.close();
await openai.close();
```

### Harness helpers

```ts
import { waitForRequest, withMockOpenAIServer, readSseData } from "@sna-sdk/testing";

await withMockOpenAIServer({ responseText: "ok" }, async (mock) => {
  const pending = waitForRequest(mock, (req) => req.endpoint === "responses");
  const res = await fetch(`${mock.url}/v1/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.4", stream: true, input: "hello" }),
  });
  const request = await pending;
  const sseLines = await readSseData(res);
});
```

## Exports

| Name | Role |
|------|------|
| `startMockAnthropicServer()` | Boot a mock Anthropic Messages API on a random port |
| `startMockOpenAIServer()` | Boot a mock OpenAI-compatible API on a random port |
| `createClaudeMockEnv()` | Create isolated Claude config and env for mock Anthropic routing |
| `createCodexMockEnv()` | Create isolated Codex config and env for mock OpenAI routing |
| `createGrokMockEnv()` | Create isolated Grok env/providerOptions for mock OpenAI Responses routing |
| `createOpenCodeMockConfig()` | Create OpenCode config/providerOptions for mock OpenAI routing |
| `createMockClaudeCli()` | Create a fake `claude` executable backed by the Anthropic mock |
| `createMockCodexExecCli()` | Create a fake `codex exec` executable backed by the OpenAI mock |
| `withMockAnthropicServer()`, `withMockOpenAIServer()` | Start a mock for a callback and always close it |
| `waitForRequest()` | Wait until a mock receives a matching request |
| `readSseData()` | Parse SSE `data:` lines from a mock response |
| `runOneshot(opts)` | Boot mock → run `claude -p` → capture → teardown |
| `MockServer`, `MockLogEntry`, `MockOpenAIServer`, `MockOpenAIRequest`, `MockOpenAILogEntry` | Types |
| `generateInstanceName`, `getInstanceDir`, `listInstances`, `readInstanceMeta`, `writeInstanceMeta`, `removeInstance` | Instance helpers used by the CLI |

## License

MIT
