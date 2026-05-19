## Design Decisions

### Canonical conversation, stored flat

Anthropic's Messages API nests blocks inside a `content` array on each message. Codex's ResponseItem stream is a sibling-level array of differently-shaped items. Each runtime also has its own way of handling images, files, thinking, tool_use, and tool_result. SNA picks neither.

Instead, every block is one row in `chat_messages`, with two orthogonal axes:

- `actor`: `user` | `assistant` | `system`
- `kind`: `text` | `thinking` | `tool_use` | `tool_result` | `status` | `error`

Why flat rather than nested:

- **Streaming-friendly.** Each row corresponds to one block, so partial flushes are natural.
- **Query-friendly.** "Find every tool_use for session X" is a normal SQL filter, not a JSON walk.
- **Provider-neutral.** Grouping into Anthropic-style messages (or Codex ResponseItems) happens in the adapter layer, not the storage layer. Adding a new provider is a new adapter, not a new schema.
- **Lossless.** Going union-of-features instead of intersection means each provider's quirks survive the round trip; going flat instead of nested means the union doesn't need a single canonical message-shape that fights both runtimes.

Binary attachments are stored in an `embeds` JSON column keyed by id; content text holds inline `![](embed://<id>)` refs. This mirrors Anthropic's "images live inside the message" semantics without forcing a JSON content array.

### 3-layer attribution

Three orthogonal axes, not one combined string:

| Layer | Field | Examples |
|-------|-------|----------|
| Runtime CLI | `provider` | `claude-code`, `codex` |
| Model vendor | `modelProvider` | `anthropic`, `openai`, `google` |
| Model slug | `model` | `claude-sonnet-4-6`, `gpt-5.4` |

The same runtime can talk to multiple model vendors (OpenCode + Anthropic, OpenCode + OpenAI, OpenRouter shimming a third). Tracing, cost aggregation, and UI badges all key off these three values; collapsing them to one would force lossy disambiguation later.

### Dual transport (HTTP + WebSocket)

State-changing operations resolve only when the server has committed the change. That's an HTTP guarantee — Promise-completion semantics line up with `await`/`then`. Real-time push (event streams, lifecycle changes, permission requests) is asymmetric and unbounded — that's WebSocket's job.

`SnaClient` wires both up so the consumer doesn't have to choose:

- `await sna.sessions.create({ label })` — completes after the DB row exists.
- `await sna.agent.start(id, { ... })` — completes after the subprocess is spawned.
- `sna.agent.onEvent(handler)` — push-only, async, ordered per session.

`server/api-types.ts` is the single source of truth for response shapes. `httpJson` and `wsReply` both consume it, so HTTP/WS drift is a TypeScript error.

### Permission flow abstracted, not exposed

Claude Code uses a PreToolUse hook (process-out-of-band, read stdin, write JSON to stdout). Codex uses JSON-RPC bidirectional approval (in-band, structured request/response). SNA hides both behind a single channel: `permission_needed` event → `permission.respond({ approved })`. Consumers register one callback regardless of provider.

`ClaudeCodeProvider.spawn` auto-injects the hook script via `--settings`, so consumers never edit `.claude/settings.json` themselves. Safe tools (`Read`, `Glob`, `Grep`, `Agent`, `TodoRead`, `TodoWrite`) auto-allow without going through the dialog.

### Configuration abstraction (hooks / MCP / policy)

Hooks, MCP servers, allowed/disallowed tools, system prompts — each runtime accepts these in its own native format. SNA defines them once in cross-provider shape on `SpawnOptions`; per-provider adapters translate. A session can be restarted onto a different provider (`agent.restart`) without rewriting the configuration.

Provider-specific knobs that don't translate go in `providerOptions: Record<string, unknown>` — opaque to the framework, defined per provider.

### Latency knobs: which to abstract, which to leave provider-specific

Two latency-control surfaces share one trait — both let a consumer ask for "less work per call" — but they sit in different places in the SDK on purpose.

**`reasoningLevel: 0..5` is cross-provider.** Every provider we support today has *some* notion of "how hard should the model think" and the runtime cost of each notch is roughly comparable across providers. So this gets a typed field on `SpawnOptions` / `CompleteOptions` and a single translation table in `core/providers/reasoning-level.ts`. Consumers pick a number, each provider adapter maps it to its own enum (`--effort low|medium|high|xhigh|max` for Claude, `model_reasoning_effort none|minimal|low|medium|high|xhigh` for Codex). OpenCode currently has no equivalent typed knob and silently ignores the field, which is honest: it's a no-op now, becomes a wire-up later if OpenCode exposes one.

**`providerOptions.serviceTier` is intentionally Codex-only.** Codex's `/fast` is a request-priority header on the OpenAI API — same model, same reasoning, just a faster routing tier (premium billing). Claude Code's `/fast`, despite sharing a name, is a *different model variant* with its own usage-credit pool (`/extra-usage` / `/usage-credits` gate). The Claude CLI itself rejects `/fast` with "Fast mode requires extra usage billing" when the user hasn't opted in. Auto-mapping `serviceTier="priority"` to Claude would silently change which billing pool the call hits — exactly the kind of surprise consumers don't forgive. So this lives under `providerOptions` rather than top-level, scoped to Codex, with the rationale in the JSDoc.

The general rule: if a knob has a 1:1 semantic counterpart across providers, it's typed and translated; if it's "the same word in two providers' UIs that means different mechanisms," it's `providerOptions.<provider-specific>` and documented explicitly.

### Session state belongs to the SDK, not the runtime

Conversation history is the SDK's source of truth. Provider-native session ids (Claude's CC session id, Codex's thread id) are kept on `Session.ccSessionId` so `--resume` works, but they are *one of two* resume strategies — the other is rebuilding from canonical blocks via `agent.resume`. Switching providers mid-conversation works because the canonical store doesn't depend on either runtime's native shape.

### Launcher API, not "is the app"

The earlier shape of this project tried to own the entire app environment — `sna up` would install dependencies, manage `pnpm dev`, set up `.claude/settings.json`. That coupling fights the "library you embed" framing. The current recommendation is `startSnaServer({ port, dbPath, ... })`: forks the standalone server, resolves native bindings, waits for ready. The consumer app's web framework, lifecycle, and process supervision stay in the consumer app.

### Mock Anthropic API for tests

Real LLM calls in CI burn budget. SNA ships `@sna-sdk/testing` with a mock Anthropic Messages API that implements the streaming SSE format. Set `ANTHROPIC_BASE_URL` to the mock and Claude Code thinks it's talking to the real API. The mock echoes user text reversed (`"hello"` → `"olleh"`) so test assertions are deterministic. `sna-test claude` wraps Claude Code with the mock + an isolated `CLAUDE_CONFIG_DIR`, so test runs don't pollute the dev account.
