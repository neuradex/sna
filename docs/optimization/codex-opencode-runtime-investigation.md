# Runtime Warmup Investigation: Codex, OpenCode, and ACP

Status: investigation notes for the optimization work. This is not a finalized architecture decision.

Context: Loom felt slower on the first rally with Codex than with Claude Code. The main question was whether SNA is using Codex in a shape that fights Codex's runtime model, and whether the same runtime-prepare idea should also guide OpenCode support.

## Current Finding

SNA currently treats providers mostly as `spawn -> send -> events` processes. That fits Claude Code reasonably well, but it is not the best shape for daemon-style runtimes.

Claude Code behaves like a per-session stream process:

- SNA spawns `claude` with stream JSON input/output.
- The first user message can be written to stdin immediately.
- The provider-native session id arrives later through the init event.
- Most startup work happens as part of one process/session lifecycle.

Codex behaves more like a runtime daemon plus provider-native threads:

- SNA starts `codex app-server`.
- The provider must initialize the app-server.
- A provider-native thread must exist before `turn/start`.
- The first `send` cannot truly begin until `thread/start` or `thread/resume` is done.

This means Codex has an extra phase that Claude Code does not expose in the same way. If that phase is hidden inside the first message path, Loom's first rally feels slower even if the model itself is not slower.

## Local Evidence

Codex protocol probing showed that one `codex app-server` can create multiple distinct threads. The relevant shape is:

```text
codex app-server
  -> thread/start
  -> thread/list
  -> thread/read
  -> turn/start(threadId)
```

Local probing created multiple distinct thread ids from one app-server. Actual model turns still require network access, but thread creation itself confirmed that the app-server is not inherently one SNA session per process.

OpenCode probing showed a similar daemon shape:

- `opencode serve` starts a headless HTTP server.
- Server APIs expose config, sessions, messages, permissions, files, MCP, auth, and events.
- `/event` is an SSE stream; local probing returned `server.connected` as the first event.
- The first `/session` request triggered project bootstrap work: database open, config loading, plugins, file watcher, VCS initialization.

In the sandbox, `opencode serve` could not bind a local port. Outside the sandbox it started successfully with:

```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

`opencode serve --port 0` failed on local OpenCode 1.14.33 even though the CLI help shows port 0 as the default. SNA should allocate a concrete free port and pass it explicitly until this is validated across versions.

## Recommended Lifecycle Split

SNA should split runtime readiness into two phases.

### 1. Global runtime prepare

This is app-level or provider-level, not session-level.

Responsibilities:

- Resolve provider binary.
- Prepare provider home/config root.
- Materialize MCP/hook/settings files.
- Start or reuse daemon runtimes where available.
- Run health checks.
- Warm project/runtime state if the provider lazily bootstraps on first API call.

Provider examples:

- Claude Code: resolve binary, verify auth/config, prepare `CLAUDE_CONFIG_DIR`, materialize hooks/MCP. No persistent daemon is required by default.
- Codex: prepare `CODEX_HOME`, start or reuse `codex app-server`, initialize it, keep it warm.
- OpenCode: start or reuse `opencode serve`, verify `/config` or health endpoint, subscribe/check `/event`, optionally trigger project bootstrap before the first user message.

### 2. Session conversation prepare

This maps an SNA session to a provider-native conversation.

Responsibilities:

- Create or resume provider-native session/thread.
- Store native id in SNA session state.
- Prepare canonical history conversion if needed.
- Ensure `send` only starts after the provider-native conversation exists.

Provider examples:

- Claude Code: native session id arrives through init; resume can use Claude's session id or SNA canonical history.
- Codex: map SNA session id to Codex thread id.
- OpenCode: map SNA session id to OpenCode session id.

## Target Shape

Codex should move toward:

```text
Codex runtime pool
  -> app-server process
  -> SNA session id -> Codex thread id
  -> send -> turn/start(threadId)
```

OpenCode should move toward:

```text
OpenCode runtime pool
  -> opencode serve process
  -> SNA session id -> OpenCode session id
  -> send -> prompt_async/session message API
  -> events -> /event SSE
```

Claude Code can stay closer to:

```text
SNA session id
  -> Claude Code process
  -> stdin/stdout stream
```

The API should still be provider-neutral from the consumer app's point of view.

## Runtime Key

Runtime reuse should be keyed by more than provider name.

Useful inputs:

- provider
- cwd/project root
- config home (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, OpenCode config root)
- model/profile/provider options
- MCP config hash
- hook/settings hash
- permission policy mode

Sketch:

```ts
type RuntimeKey =
  | {
      provider: "claude-code";
      cwd: string;
      configDir?: string;
      mcpConfigHash?: string;
      settingsHash?: string;
    }
  | {
      provider: "codex";
      cwd: string;
      configDir?: string;
      profile?: string;
      mcpConfigHash?: string;
    }
  | {
      provider: "opencode";
      cwd: string;
      configDir?: string;
      modelConfigHash?: string;
      mcpConfigHash?: string;
    };
```

## ACP Evaluation

ACP is useful, but it is not a replacement for SNA's runtime control plane.

ACP helps with the conversation layer:

- session creation/loading
- prompt turns
- session updates
- cancellation
- tool call event shapes
- permission request shape
- capability negotiation

SNA still owns the runtime layer:

- global runtime prepare
- port allocation
- daemon lifecycle
- runtime pool reuse
- native session/thread mapping
- config home materialization
- provider-native API usage
- product history persistence
- policy enforcement and audit

Recommended stance:

```text
SNA internal runtime control plane: native/direct
SNA conversation/event model: ACP-shaped where useful
Provider adapters: native Claude/Codex/OpenCode plus optional generic ACP provider
External compatibility: optional SNA ACP server later
```

This keeps the optimization levers available while still borrowing ACP's already-designed session, tool, permission, and update shapes.

## OpenCode Integration Recommendation

Do not start with ACP as the primary OpenCode integration. Start with OpenCode Server/SDK.

Reasoning:

- OpenCode Server exposes the control surface SNA needs: sessions, prompt async, permissions, events, config, file state, MCP, auth.
- The OpenCode SDK is a typed client for that server, so it can reduce HTTP glue without changing the runtime model.
- `opencode acp` is better treated as a generic ACP provider path, not the highest-fidelity OpenCode provider.

Recommended implementation order:

1. Add a runtime prepare abstraction without changing the public chat API too much.
2. Move Codex toward app-server pooling and SNA-session-to-thread mapping.
3. Add OpenCode via `opencode serve` plus SDK/client calls.
4. Make SNA's normalized conversation events closer to ACP where that reduces adapter code.
5. Add a generic ACP provider later for breadth.
6. Consider exposing SNA itself as an ACP server after the internal runtime model is stable.

## Open Questions

- Can Codex safely run concurrent active turns across multiple threads in one app-server process?
- Which Codex config changes require a distinct app-server process versus a new thread?
- How should SNA persist and recover runtime pool state after SNA server restart?
- How should OpenCode sessions be isolated when cwd, model, MCP, or permission policy differs?
- Should OpenCode project bootstrap be triggered by global runtime prepare or by session prepare?
- What is the minimum ACP-shaped event schema SNA should adopt without losing provider-native details?

## References

- Codex SDK: https://developers.openai.com/codex/sdk
- Codex app-server: https://developers.openai.com/codex/app-server
- OpenCode SDK: https://opencode.ai/docs/ja/sdk/
- OpenCode Server: https://opencode.ai/docs/ja/server/
- OpenCode ACP: https://opencode.ai/docs/ja/acp/
- ACP protocol: https://agentclientprotocol.com/
