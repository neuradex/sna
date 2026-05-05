# ACP (Agent Client Protocol) — Evaluation Notes

Status: investigation notes for ACP adoption. This is not a finalized architecture decision.

Sibling note: [codex-opencode-runtime-investigation.md](codex-opencode-runtime-investigation.md) — has a shorter "ACP Evaluation" section as part of the broader runtime warmup work. This file goes deeper into ACP-specific comparison and integration scenarios; the two should be read together.

Source: https://agentclientprotocol.com/

## 1. What ACP is

A standardized protocol — JSON-RPC over stdio (local) or HTTP/WebSocket (remote) — between **clients** (code editors / IDEs) and **agents** (AI coding assistants). The pitch is "LSP for coding agents": an agent that speaks ACP works in any ACP-compatible editor without per-pair integration work.

ACP standardizes:
- Transport (stdio / HTTP / WS)
- Message format (JSON-RPC, with agentic types like diff visualization; reuses MCP JSON shapes where applicable)
- Capability negotiation between client and agent
- Markdown as the default text format

ACP does NOT (as of writing) define: authentication, deep security model, or comprehensive remote-agent specifics.

## 2. ACP vs SNA — different layers

| | ACP | SNA |
|---|---|---|
| Nature | Wire protocol spec | Runtime server |
| Host model | Editor hosts; agent connects | Consumer app hosts SNA; SNA spawns agent CLI as child |
| Unifies | Editor ↔ agent communication | Claude Code and Codex behind one API surface |
| Statefulness | Stateless message contract | Stateful: multi-session, SQLite canonical history, permission queue |
| Primary audience | Editor vendors + agent vendors solving N×M integration | App developers embedding a coding-agent backend (Electron / web) |

**They solve different problems.** ACP solves "how do editors talk to agents?". SNA solves "how do I embed an agent runtime as my app's backend?". Neither subsumes the other.

## 3. Does ACP make SNA unnecessary?

No. ACP defines none of SNA's core value:

- Multi-session lifecycle (`SessionManager`, per-session cwd / meta / event buffer)
- Provider mid-session swap via canonical blocks (`history/canonical.ts` + `history/{claude-code,codex}.ts`)
- SQLite persistence and resume-after-restart
- Electron launcher with asar-unpacked native binding resolution and `better-sqlite3` rebuild path
- React bindings and drop-in chat UI (`@sna-sdk/react`)
- Unified permission flow over Claude Code's PreToolUse hook and Codex's JSON-RPC approval

ACP is a wire format; SNA is everything around the wire.

## 4. The ACP registry — relevant entries

The registry already lists ~50 ACP-compatible agents, including:

- **Claude Agent** (`0.31.4`) — ACP wrapper for Anthropic Claude
- **Codex CLI** (`0.12.0`) — ACP adapter for OpenAI Codex
- **Gemini CLI**, **GitHub Copilot**, **Cursor**, **Junie** (JetBrains), **Cline**, **goose**, **OpenCode**, **Qwen Code**, **Kimi CLI**, **Mistral Vibe**, **Auggie CLI**, **Amp**, **fast-agent**, …

Implication: SNA's two existing providers both have ACP-compatible counterparts in the registry. Whether those are official or third-party wrappers, and whether they preserve native-CLI control surfaces (e.g. Claude Code's `--settings` hook injection, mid-session model swap), needs verification before relying on them.

## 5. Integration scenarios

### Scenario A — SNA consumes ACP (provider layer → ACP client)

Replace per-CLI provider adapters with a single ACP client.

Gains:
- Provider adapter count: 2 → 1
- Permission/tool message normalization simplifies (whatever ACP standardizes is no longer SNA's job)
- ~50 ACP-compatible agents become candidates for SNA's `provider` axis with config alone

Risks / open questions:
- Does the Claude Agent ACP wrapper preserve Claude Code's native control surfaces (PreToolUse hook auto-injection, raw `stream-json`, `setModel` mid-run)?
- Does ACP define session resume in a way that supports SNA's portable canonical history? If not, mid-session provider swap still needs per-provider history adapters.
- ACP wrappers are a translation layer — bugs/lag here become SNA bugs.

### Scenario B — SNA exposes ACP (transport layer → ACP server)

Add an ACP server transport alongside the existing HTTP/WS, reusing the same `SessionManager`.

Gains:
- Any ACP-compatible editor (Zed, Cursor, Junie, …) can connect to SNA and inherit SNA's value-adds: multi-session, SQLite history, provider mid-session swap, React-side parity not required.
- Repositions SNA from "Claude Code/Codex backend" to "portable coding-agent runtime" — broader market without losing existing one.
- Low risk: additive transport, no provider-layer churn.

Open questions:
- Does ACP's session model fit SNA's canonical-flat block model without info loss?
- Permission flow: does ACP let SNA push approvals to the editor side cleanly?

### Recommended sequencing

1. **Scenario B first.** Highest reward-to-risk: additive, doesn't touch providers, opens IDE market.
2. **Investigate ACP spec** for session resume, permission flow, and mid-session model selection. These three answer whether Scenario A is clean or lossy.
3. **Scenario A behind a flag** if (2) checks out: add `core/providers/acp.ts` parallel to existing native adapters; do not retire native until feature parity is proven.
4. **Retire native adapters only if** ACP wrappers reach parity for Claude Code / Codex; otherwise keep both — native for power users, ACP for breadth.

## 6. Decision points to resolve before committing

- [ ] Read ACP session/resume spec — does it accommodate SNA's canonical blocks?
- [ ] Read ACP permission/tool-approval spec — can SNA's `permission_needed` event map cleanly?
- [ ] Read ACP capability negotiation — is mid-session model change a first-class operation?
- [ ] Verify Claude Agent and Codex CLI ACP wrappers (registry) preserve native control surfaces.
- [ ] Prototype Scenario B (server/acp.ts) against Zed to validate the SessionManager fits.

Until these answer cleanly, default to status quo (native adapters) and treat ACP as a watch item.
