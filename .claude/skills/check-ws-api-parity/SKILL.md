---
description: Comprehensively audit WS ↔ HTTP API parity in sna-core. Reads source files, extracts all operations from both protocols, compares them, and reports any gaps or inconsistencies.
---

## WS ↔ API Parity Check

Perform a **comprehensive parity audit** between the WebSocket protocol and the HTTP REST API in `packages/core/src/server/`. The goal is to surface any design gaps so both protocols stay in perfect sync.

### Source files to read (always re-read, never use cached knowledge)

```
packages/core/src/server/api-types.ts        — ApiResponses type contract (canonical list)
packages/core/src/server/ws.ts               — WS switch cases + push events
packages/core/src/server/routes/agent.ts     — HTTP agent + session routes
packages/core/src/server/routes/chat.ts      — HTTP chat routes
packages/core/src/server/routes/emit.ts      — HTTP emit route
packages/core/src/server/routes/events.ts    — HTTP SSE events route
packages/core/src/server/routes/run.ts       — HTTP run route (if exists)
```

### Step 1 — Extract from `api-types.ts`

Read the file and collect every key in the `ApiResponses` interface. These are the **declared operations** that both HTTP and WS should implement.

List: `api_ops[]`

### Step 2 — Extract from `ws.ts`

Read the file and collect:

**A. WS request-response operations** — every `case "..."` in the `handleMessage` switch. These must each correspond to an `ApiResponses` key (except pure-subscribe operations: `agent.subscribe`, `agent.unsubscribe`, `events.subscribe`, `events.unsubscribe`, `permission.subscribe`, `permission.unsubscribe`).

List: `ws_cases[]`

**B. WS push event types** — every `type: "..."` string used in `send(ws, ...)` calls that are *server-initiated* (not replies). These have no HTTP equivalent by design.

List: `ws_push_types[]`

**C. WS-only operations** — operations in `ws_cases[]` that intentionally have no HTTP equivalent (e.g., subscribe/unsubscribe ops). Document why they're WS-only.

### Step 3 — Extract from HTTP routes

Read each route file and collect:

**A. HTTP operations using `httpJson(c, "op.name", ...)` calls** — the quoted op name is the `ApiResponses` key being used.

List: `http_ops[]` (with file and HTTP method/path for each)

**B. HTTP-only routes** — routes that return JSON but do NOT use `httpJson` (i.e., not typed against `ApiResponses`). These are candidates for being added to the contract.

**C. SSE endpoints** — routes that stream via SSE (`streamSSE`). These are the HTTP counterparts to WS subscription events.

List: `http_sse_endpoints[]`

### Step 4 — Cross-reference and find gaps

Compare the four lists to identify discrepancies:

#### 4a. `api-types.ts` gaps
- **In `api_ops` but NOT in `ws_cases`** (excluding subscribe ops): WS is missing an operation that HTTP implements.
- **In `api_ops` but NOT in `http_ops`**: HTTP is missing an operation that is in the contract.
- **In `ws_cases` (response ops) but NOT in `api_ops`**: WS uses an untyped reply — should be added to `ApiResponses`.
- **In `http_ops` but NOT in `api_ops`**: HTTP uses an untyped response — should be added to `ApiResponses`.

#### 4b. Payload shape gaps
For each operation that exists in **both** WS and HTTP, compare the **request parameters** accepted:
- Read the WS handler function body (what fields does it read from `msg`?)
- Read the HTTP route handler body (what fields does it read from `body`/query?)
- Flag any field that is accepted in one but not the other.

#### 4c. Response shape gaps
For operations in both protocols, verify both use the **same `ApiResponses` key** (enforced by TypeScript, but confirm visually).

#### 4d. SSE ↔ WS subscription parity
| Concern | HTTP SSE | WS push |
|---------|----------|---------|
| Agent events | `GET /agent/events?session=<id>` | `agent.subscribe` + `agent.event` push |
| Skill events | `GET /events?since=<id>` | `events.subscribe` + `skill.event` push |
| Permission requests | poll `GET /agent/permission-pending` (if exists) | `permission.subscribe` + `permission.request` push |
| Session state | no HTTP equivalent | `sessions.snapshot`, `session.lifecycle`, `session.state-changed`, `session.config-changed` auto-push |

Note which SSE streams have a WS counterpart and which do not, and whether that is intentional.

#### 4e. WS-only features (intentional, document as such)
- Session update (`sessions.update`) — does HTTP have `PATCH /sessions/:id`?
- Auto-push snapshot (`sessions.snapshot`) — server-initiated, no HTTP poll equivalent
- `session.lifecycle`, `session.state-changed`, `session.config-changed` — push-only, no HTTP equivalent

### Step 5 — Report

Output a structured report with these sections:

---

**✅ COVERED — Operations correctly implemented in both protocols**
List each operation, its WS case, its HTTP method+path, and confirm payload parity.

**⚠️ GAPS — Operations with discrepancies**
For each gap found in Step 4, describe:
- What is missing or inconsistent
- Which file and line (if determinable)
- Recommended fix

**📡 WS-ONLY (intentional)**
List operations that exist only in WS and explain why (real-time push, bidirectional, etc.)

**🌐 HTTP-ONLY (intentional)**
List routes that exist only in HTTP and explain why (e.g., image serving, SSE streams).

**🔴 ACTION REQUIRED**
Summarize any genuine bugs or design gaps that need to be fixed to achieve perfect parity.

---

### Rules

- Read source files fresh every time — do not rely on memory or prior conversation context.
- Do not modify any files. This is a read-only audit.
- Be exhaustive: check every route, every WS case, every field.
- If a gap is intentional by design, say so explicitly.
- All output must be in English.
