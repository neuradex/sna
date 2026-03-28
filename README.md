# SNA — Skills-Native Application SDK

**An application framework that uses Claude Code as the runtime.**

Traditional AI apps call an LLM API and parse the response. SNA flips this — Claude Code itself executes the application logic.

```
Traditional:  your code → LLM API → parse → act
SNA:          SKILL.md → Claude Code → scripts → SQLite → SSE → UI
```

## Design Philosophy

- **Claude Code IS the runtime** — Not a wrapper around an LLM API. Claude Code directly executes application logic through skills.
- **SDK owns the pipeline, app owns the data** — The event pipeline (emit → DB → SSE → hooks) is entirely managed by the SDK. Applications only manage their own domain data.
- **Skills are the logic layer** — Business logic lives in `SKILL.md` files, not application code. Markdown is both the spec and the implementation.
- **Real-time by default** — Skill execution is async and can take minutes. The event protocol (`start` → `milestone` → `complete`) is mandatory, keeping the UI always in sync.
- **Zero config for non-engineers** — One command (`sna up`) starts everything. Local SQLite, no cloud dependency.
- **Agents enforce conventions** — SDK rules are taught to coding agents via the `sna-builder` plugin, not just documented for humans.

## How It Works

1. User invokes a skill in the app's chat UI or terminal (e.g. `/form-register`)
2. Claude Code reads `.claude/skills/<name>/SKILL.md` and executes TypeScript scripts
3. Scripts read/write to the app's SQLite database
4. Events (start, progress, complete) are delivered to the frontend in real-time via the SDK
5. Frontend auto-refreshes

## Packages

| Package | npm name | Role |
|---------|----------|------|
| `packages/core` | `@sna-sdk/core` | Server runtime, DB, CLI, event pipeline |
| `packages/react` | `@sna-sdk/react` | React hooks, components, stores |

## Quick Start

```bash
pnpm install
cd packages/core && pnpm build
cd packages/react && pnpm build
```

See the [App Setup guide](docs/app-setup.md) for application-side configuration.

## Documentation

| Document | Contents |
|----------|----------|
| [Architecture](docs/architecture.md) | DB separation, event pipeline, package structure |
| [Skill Authoring](docs/skill-authoring.md) | How to write skills |
| [App Setup](docs/app-setup.md) | Frontend, server, Vite configuration |
| [Contributing](CONTRIBUTING.md) | Repository structure, key files, tech stack |

## Claude Code Plugin

Includes a Claude Code plugin for SNA app development. An agent that automatically follows SDK conventions.

```bash
# Local testing
claude --plugin-dir ./plugins/sna-builder

# Install from marketplace
/plugin marketplace add neuradex/sna
/plugin install sna-builder@sna
```
