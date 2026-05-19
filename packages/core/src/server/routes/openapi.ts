/**
 * OpenAPI route definitions for SNA SDK using @hono/zod-openapi.
 *
 * Uses createRoute() + OpenAPIHono.openapi() pattern for typed, auto-documenting endpoints.
 * Zod schemas validate requests and generate OpenAPI spec automatically.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { streamSSE } from "hono/streaming";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import {
  getProvider,
  spawnWithPool,
  type AgentEvent,
} from "../../core/providers/index.js";
import { logger } from "../../lib/logger.js";
import { getDb } from "../../db/schema.js";
import { SessionManager } from "../session-manager.js";
import type { SessionConfig } from "../session-manager.js";
import { buildCanonicalFromDb } from "../../history/canonical.js";
import { saveEmbeds } from "../image-store.js";
import { insertChatMessage } from "../../db/chat-messages.js";
import { formatEmbedRef } from "../../history/embed-refs.js";
import type { EmbedRecord } from "../../history/types.js";
import { getConfig } from "../../config.js";
import { completion, type CompletionOptions } from "../../core/completion.js";
import type { ContentBlock } from "../../core/providers/types.js";
import { resolveImagePath } from "../image-store.js";
import { runOnce, type RunOnceOptions } from "../run-once.js";

// Resolve our own version from package.json so the OpenAPI document
// reports whatever ships in @sna-sdk/core, not a hard-coded string that
// drifts every release. The relative path is the same in src/ and dist/
// (both live three levels deep under the package root).
const localRequire = createRequire(import.meta.url);
const SNA_VERSION: string = ((): string => {
  try {
    return localRequire("../../../package.json").version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// ── Shared schemas ────────────────────────────────────────────────────

const sessionStateSchema = z.enum(["idle", "processing", "waiting", "permission"]);
const agentStatusSchema = z.enum(["idle", "busy", "disconnected"]);

const SessionConfigSchema = z.object({
  provider: z.string(),
  modelProvider: z.string().optional(),
  model: z.string(),
  cwd: z.string(),
  permissionMode: z.string().optional(),
  configDir: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  providerOptions: z.record(z.string(), z.any()).optional(),
});

const RuntimeChainEntrySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  config: SessionConfigSchema,
  state: sessionStateSchema,
  spawnedAt: z.number(),
  retiredAt: z.number().nullable(),
});

const SessionInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  alive: z.boolean(),
  state: sessionStateSchema,
  agentStatus: agentStatusSchema,
  cwd: z.string(),
  meta: z.record(z.string(), z.any()).nullable(),
  config: SessionConfigSchema.nullable(),
  ccSessionId: z.string().nullable(),
  eventCount: z.number(),
  messageCount: z.number(),
  lastMessage: z.object({
    actor: z.string(),
    kind: z.string(),
    content: z.string(),
    created_at: z.string(),
  }).nullable(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
  currentRuntimeId: z.string().nullable(),
  runtimeChain: z.array(RuntimeChainEntrySchema).optional(),
});

const ErrorResponse = z.object({
  status: z.literal("error"),
  message: z.string(),
  stack: z.string().optional(),
});

// ── Health ────────────────────────────────────────────────────────────

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Health check",
  description: "Verify the SNA server is running.",
  responses: {
    200: {
      description: "Server is healthy.",
      content: { "application/json": { schema: z.object({ ok: z.literal(true), name: z.literal("sna"), version: z.string() }) } },
    },
  },
});

// ── SNA Port ──────────────────────────────────────────────────────────

const snaPortRoute = createRoute({
  method: "get",
  path: "/api/sna-port",
  summary: "Get SNA API port",
  description: "Returns the dynamically allocated SNA API port.",
  responses: {
    200: {
      description: "Port number.",
      content: { "application/json": { schema: z.object({ port: z.number() }) } },
    },
    503: {
      description: "SNA API not running.",
      content: { "application/json": { schema: z.object({ port: z.null(), error: z.string() }) } },
    },
  },
});

// ── Session CRUD ──────────────────────────────────────────────────────

const createSessionRoute = createRoute({
  method: "post",
  path: "/agent/sessions",
  summary: "Create a session",
  description: "Create a new agent session. Session IDs default to 8-char random prefix.",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        id: z.string().optional(),
        label: z.string().optional(),
        cwd: z.string().optional(),
        meta: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Session created.",
      content: { "application/json": { schema: z.object({
        status: z.literal("created"),
        sessionId: z.string(),
        label: z.string(),
        meta: z.record(z.string(), z.any()).nullable(),
      }) } },
    },
    409: {
      description: "Max sessions reached.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Internal server error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const listSessionsRoute = createRoute({
  method: "get",
  path: "/agent/sessions",
  summary: "List sessions",
  description: "List all agent sessions. Pass `?include=chain` to embed each session's full RuntimeSession audit chain in the response.",
  request: {
    query: z.object({
      include: z.enum(["chain"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Session list.",
      content: { "application/json": { schema: z.object({ sessions: z.array(SessionInfoSchema) }) } },
    },
  },
});

const removeSessionRoute = createRoute({
  method: "delete",
  path: "/agent/sessions/{id}",
  summary: "Remove a session",
  description: "Remove an agent session. Cannot remove 'default'.",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Session removed.",
      content: { "application/json": { schema: z.object({ status: z.literal("removed") }) } },
    },
    400: {
      description: "Cannot remove default session.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    404: {
      description: "Session not found.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Internal server error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const updateSessionRoute = createRoute({
  method: "patch",
  path: "/agent/sessions/{id}",
  summary: "Update session",
  description: "Update session metadata (label, meta, cwd).",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: z.object({
        label: z.string().optional(),
        meta: z.record(z.string(), z.any()).optional(),
        cwd: z.string().optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Session updated.",
      content: { "application/json": { schema: z.object({ status: z.literal("updated"), session: z.string() }) } },
    },
    404: {
      description: "Session not found.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Internal server error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// ── Agent Lifecycle ───────────────────────────────────────────────────

const startRoute = createRoute({
  method: "post",
  path: "/agent/start",
  summary: "Start agent",
  description: "Start an agent in a session. Idempotent — returns already_running if alive.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({
        provider: z.string().optional(),
        modelProvider: z.string().optional(),
        prompt: z.string().optional(),
        model: z.string().optional(),
        permissionMode: z.string().optional(),
        configDir: z.string().optional(),
        force: z.boolean().optional(),
        meta: z.record(z.string(), z.any()).optional(),
        extraArgs: z.array(z.string()).optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
        disallowedTools: z.array(z.string()).optional(),
        mcpServers: z.record(z.string(), z.any()).optional(),
        cwd: z.string().optional(),
        history: z.array(z.any()).optional(),
        env: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Agent started or already running.",
      content: { "application/json": { schema: z.object({
        status: z.enum(["started", "already_running"]),
        provider: z.string(),
        sessionId: z.string(),
      }) } },
    },
    500: {
      description: "Start failed.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const sendRoute = createRoute({
  method: "post",
  path: "/agent/send",
  summary: "Send message",
  description: "Send a message to the agent. Supports multi-modal with images.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({
        message: z.string().optional(),
        images: z.array(z.object({
          base64: z.string(),
          mimeType: z.string(),
        })).optional(),
        meta: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Message sent.",
      content: { "application/json": { schema: z.object({ status: z.literal("sent") }) } },
    },
    400: {
      description: "No active session or empty message.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Internal server error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const restartRoute = createRoute({
  method: "post",
  path: "/agent/restart",
  summary: "Restart agent",
  description: "Kill and re-spawn agent. Same provider uses --resume; different provider injects DB history.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({
        provider: z.string().optional(),
        modelProvider: z.string().optional(),
        model: z.string().optional(),
        cwd: z.string().optional(),
        permissionMode: z.string().optional(),
        configDir: z.string().optional(),
        extraArgs: z.array(z.string()).optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
        disallowedTools: z.array(z.string()).optional(),
        mcpServers: z.record(z.string(), z.any()).optional(),
        env: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Agent restarted.",
      content: { "application/json": { schema: z.object({
        status: z.literal("restarted"),
        provider: z.string(),
        sessionId: z.string(),
      }) } },
    },
    500: {
      description: "Restart failed.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const resumeRoute = createRoute({
  method: "post",
  path: "/agent/resume",
  summary: "Resume session",
  description: "Resume a session with DB history auto-injected.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({
        prompt: z.string().optional(),
        model: z.string().optional(),
        permissionMode: z.string().optional(),
        configDir: z.string().optional(),
        provider: z.string().optional(),
        modelProvider: z.string().optional(),
        extraArgs: z.array(z.string()).optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
        disallowedTools: z.array(z.string()).optional(),
        mcpServers: z.record(z.string(), z.any()).optional(),
        env: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Session resumed.",
      content: { "application/json": { schema: z.object({
        status: z.literal("resumed"),
        provider: z.string(),
        sessionId: z.string(),
        historyCount: z.number(),
      }) } },
    },
    400: {
      description: "No history and no prompt.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Resume failed.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const interruptRoute = createRoute({
  method: "post",
  path: "/agent/interrupt",
  summary: "Interrupt agent",
  description: "Interrupt current turn. Process stays alive.",
  request: {
    query: z.object({ session: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Interrupted.",
      content: { "application/json": { schema: z.object({
        status: z.enum(["interrupted", "no_session"]),
      }) } },
    },
  },
});

const setModelRoute = createRoute({
  method: "post",
  path: "/agent/set-model",
  summary: "Set model",
  description: "Change model at runtime without restart.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({ model: z.string() }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Model updated.",
      content: { "application/json": { schema: z.object({
        status: z.enum(["updated", "no_session"]),
        model: z.string(),
      }) } },
    },
  },
});

const setPermissionModeRoute = createRoute({
  method: "post",
  path: "/agent/set-permission-mode",
  summary: "Set permission mode",
  description: "Change permission mode at runtime without restart.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({ permissionMode: z.string() }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Permission mode updated.",
      content: { "application/json": { schema: z.object({
        status: z.enum(["updated", "no_session"]),
        permissionMode: z.string(),
      }) } },
    },
  },
});

const sessionPatchRoute = createRoute({
  method: "patch",
  path: "/agent/session",
  summary: "Patch session config",
  description: [
    "Unified PATCH mutator. Applies the patch in-place where the provider",
    "supports it (codex per-turn cwd/model/sandbox override; claude-code",
    "control_request for model/permissionMode). Leftover fields drive a",
    "respawn-with-history. Response's `applied` reports which path was taken.",
  ].join(" "),
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({
        cwd: z.string().optional(),
        model: z.string().optional(),
        permissionMode: z.string().optional(),
      }) } },
    },
  },
  responses: {
    200: {
      description: "Patch applied.",
      content: { "application/json": { schema: z.object({
        status: z.literal("updated"),
        applied: z.enum(["in-place", "respawn"]),
        runtimeId: z.string(),
        fields: z.array(z.string()),
      }) } },
    },
    400: {
      description: "Session has no active runtime, or respawn failed.",
      content: { "application/json": { schema: z.object({
        status: z.literal("error"),
        message: z.string(),
      }) } },
    },
    404: {
      description: "Session not found.",
      content: { "application/json": { schema: z.object({
        status: z.literal("error"),
        message: z.string(),
      }) } },
    },
  },
});

const killRoute = createRoute({
  method: "post",
  path: "/agent/kill",
  summary: "Kill agent",
  description: "Kill the agent process. Session stays for restart.",
  request: {
    query: z.object({ session: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Agent killed.",
      content: { "application/json": { schema: z.object({
        status: z.enum(["killed", "no_session"]),
      }) } },
    },
  },
});

const statusRoute = createRoute({
  method: "get",
  path: "/agent/status",
  summary: "Agent status",
  description: "Check session status, event count, and last message.",
  request: {
    query: z.object({ session: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Session status.",
      content: { "application/json": { schema: z.object({
        alive: z.boolean(),
        agentStatus: agentStatusSchema,
        sessionId: z.string().nullable(),
        ccSessionId: z.string().nullable(),
        eventCount: z.number(),
        messageCount: z.number(),
        lastMessage: z.object({
          actor: z.string(),
          kind: z.string(),
          content: z.string(),
          created_at: z.string(),
        }).nullable(),
        config: SessionConfigSchema.nullable(),
      }) } },
    },
  },
});

// ── One-shot ──────────────────────────────────────────────────────────

const runOnceRoute = createRoute({
  method: "post",
  path: "/agent/run-once",
  summary: "Run once",
  description: "One-shot: create temp session → spawn → execute → return → cleanup.",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        message: z.string(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        permissionMode: z.string().optional(),
        cwd: z.string().optional(),
        timeout: z.number().optional(),
        provider: z.string().optional(),
        extraArgs: z.array(z.string()).optional(),
        env: z.record(z.string(), z.any()).optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Execution result.",
      content: { "application/json": { schema: z.object({
        result: z.string(),
        usage: z.record(z.string(), z.any()).nullable(),
      }) } },
    },
    400: {
      description: "Missing message.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Execution failed or timed out.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const completionRoute = createRoute({
  method: "post",
  path: "/agent/completion",
  summary: "Completion",
  description: "Lightweight one-shot LLM call without session management.",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        prompt: z.string(),
        provider: z.string().optional(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        cwd: z.string().optional(),
        env: z.record(z.string(), z.any()).optional(),
        extraArgs: z.array(z.string()).optional(),
        label: z.string().optional(),
        timeout: z.number().optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Completion result with usage and cost.",
      content: { "application/json": { schema: z.object({
        text: z.string(),
        usage: z.object({
          inputTokens: z.number(),
          outputTokens: z.number(),
          cacheReadTokens: z.number(),
          cacheCreationTokens: z.number(),
        }),
        costUsd: z.number(),
        durationMs: z.number(),
        durationApiMs: z.number(),
        model: z.string(),
      }) } },
    },
    400: {
      description: "Missing prompt.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Completion failed.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// ── Permission ────────────────────────────────────────────────────────

const permissionRequestRoute = createRoute({
  method: "post",
  path: "/agent/permission-request",
  summary: "Permission request",
  description: "Blocking: submit a permission request and wait for approval/denial.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({
        tool_name: z.string().optional(),
        tool_input: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Permission decision result.",
      content: { "application/json": { schema: z.object({ approved: z.boolean() }) } },
    },
  },
});

const permissionRespondRoute = createRoute({
  method: "post",
  path: "/agent/permission-respond",
  summary: "Permission respond",
  description: "Approve or deny a pending permission request.",
  request: {
    query: z.object({ session: z.string().optional() }),
    body: {
      content: { "application/json": { schema: z.object({ approved: z.boolean() }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Permission responded.",
      content: { "application/json": { schema: z.object({
        status: z.enum(["approved", "denied"]),
      }) } },
    },
    404: {
      description: "No pending permission.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Internal server error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const listModelsRoute = createRoute({
  method: "post",
  path: "/agent/list-models",
  summary: "List models",
  description:
    "Provider model introspection. POST (not GET) because `config` may carry an `apiKey` we don't want logged in URLs or proxy access logs. The response shape is provider-driven; `error` is set on partial failures (CLI missing, unreachable endpoint).",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              runtime: z.string().optional(),
              config: z
                .object({
                  cliPath: z.string().optional(),
                  baseUrl: z.string().optional(),
                  apiKey: z.string().optional(),
                  refresh: z.boolean().optional(),
                })
                .optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Available models for the runtime.",
      content: {
        "application/json": {
          schema: z.object({
            models: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                provider: z.string(),
                source: z.enum(["static", "api", "cli"]),
                contextWindow: z.number().optional(),
                deprecated: z.boolean().optional(),
                notes: z.string().optional(),
              }),
            ),
            source: z.enum(["static", "api", "cli", "mixed"]),
            fetchedAt: z.number(),
            error: z.string().optional(),
          }),
        },
      },
    },
    400: {
      description: "Unknown runtime.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "listModels call failed.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const agentEventsRoute = createRoute({
  method: "get",
  path: "/agent/events",
  summary: "Agent event SSE stream",
  description:
    "Server-Sent Events stream of agent events for a session. Replays buffered events from `since` (or the latest cursor), then streams live. Each SSE message carries an `id` equal to the event cursor (so clients can resume with `?since=<id>`), except transient deltas (`assistant_delta`, `tool_use_delta`, …) which are sent without an id. The stream stays open indefinitely; the server sends keepalive comments every `keepaliveIntervalMs` (see `getConfig()`).",
  request: {
    query: z.object({
      session: z.string().optional().describe("Session id (defaults to 'default')."),
      since: z
        .string()
        .optional()
        .describe("Cursor to resume from. Omit to start at the current head."),
    }),
  },
  responses: {
    200: {
      description: "An open SSE stream. The response body is `text/event-stream`.",
      content: {
        "text/event-stream": {
          schema: z
            .string()
            .describe(
              "SSE stream. Each `data:` line is a JSON-encoded AgentEvent.",
            ),
        },
      },
    },
  },
});

const permissionPendingRoute = createRoute({
  method: "get",
  path: "/agent/permission-pending",
  summary: "Pending permissions",
  description: "List pending permission requests. Without session param, returns all.",
  request: {
    query: z.object({ session: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Pending permissions.",
      content: { "application/json": { schema: z.object({
        pending: z.array(z.object({
          sessionId: z.string(),
          request: z.record(z.string(), z.any()),
          createdAt: z.number(),
        })),
      }) } },
    },
  },
});

// ── Chat Sessions ─────────────────────────────────────────────────────

const chatListSessionsRoute = createRoute({
  method: "get",
  path: "/chat/sessions",
  summary: "List chat sessions",
  description: "List all chat sessions from the database.",
  responses: {
    200: {
      description: "Chat sessions.",
      content: { "application/json": { schema: z.object({
        sessions: z.array(z.object({
          id: z.string(),
          label: z.string(),
          type: z.string(),
          meta: z.string().nullable(),
          cwd: z.string().nullable(),
          created_at: z.string(),
        })),
      }) } },
    },
    500: {
      description: "Database error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const chatCreateSessionRoute = createRoute({
  method: "post",
  path: "/chat/sessions",
  summary: "Create chat session",
  description: "Create a new chat session in the database.",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        id: z.string().optional(),
        label: z.string().optional(),
        type: z.string().optional(),
        chatType: z.string().optional(),
        meta: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Chat session created.",
      content: { "application/json": { schema: z.object({
        status: z.literal("created"),
        id: z.string(),
        meta: z.record(z.string(), z.any()).nullable(),
      }) } },
    },
    500: {
      description: "Database error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const chatDeleteSessionRoute = createRoute({
  method: "delete",
  path: "/chat/sessions/{id}",
  summary: "Delete chat session",
  description: "Delete a chat session. Cannot delete 'default'.",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Chat session deleted.",
      content: { "application/json": { schema: z.object({ status: z.literal("deleted") }) } },
    },
    400: {
      description: "Cannot delete default session.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Database error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// ── Chat Messages ─────────────────────────────────────────────────────

const chatListMessagesRoute = createRoute({
  method: "get",
  path: "/chat/sessions/{id}/messages",
  summary: "List chat messages",
  description: "Get messages for a chat session. Supports pagination via 'since' and 'limit'.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      since: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Chat messages.",
      content: { "application/json": { schema: z.object({ messages: z.array(z.unknown()) }) } },
    },
    500: {
      description: "Database error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const chatCreateMessageRoute = createRoute({
  method: "post",
  path: "/chat/sessions/{id}/messages",
  summary: "Create chat message",
  description: "Add a message to a chat session.",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: z.object({
        actor: z.enum(["user", "assistant", "system"]),
        kind: z.enum(["text", "thinking", "tool_use", "tool_result", "status", "error"]),
        content: z.string().optional(),
        embeds: z.record(z.string(), z.any()).optional(),
        meta: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Message created.",
      content: { "application/json": { schema: z.object({
        status: z.literal("created"),
        id: z.number(),
      }) } },
    },
    400: {
      description: "Missing actor or kind.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Database error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const chatClearMessagesRoute = createRoute({
  method: "delete",
  path: "/chat/sessions/{id}/messages",
  summary: "Clear chat messages",
  description: "Clear all messages in a chat session.",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Messages cleared.",
      content: { "application/json": { schema: z.object({ status: z.literal("cleared") }) } },
    },
    500: {
      description: "Database error.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// ── Image Serving ─────────────────────────────────────────────────────

const serveImageRoute = createRoute({
  method: "get",
  path: "/chat/images/{sessionId}/{filename}",
  summary: "Serve image",
  description: "Serve a stored image with appropriate Content-Type and cache headers.",
  request: {
    params: z.object({
      sessionId: z.string(),
      filename: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Image binary.",
      content: { "image/png": { schema: z.any() } },
    },
    404: {
      description: "Image not found.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// ── OpenAPI App Factory ───────────────────────────────────────────────

function getSessionId(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query("session") ?? "default";
}

export async function createOpenApiApp(options?: { sessionManager?: SessionManager }) {
  const app = new OpenAPIHono();

  const openApiInfo = {
    openapi: "3.1.0" as const,
    info: {
      title: "SNA SDK API",
      version: SNA_VERSION,
      description: "Skills-Native Application SDK — HTTP API for spawning and communicating with AI agent providers (Claude Code, Codex, OpenCode).",
    },
  };

  // Swagger UI — accessible at /docs
  app.doc("/openapi.json", openApiInfo);

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  // Plain JSON spec viewer — non-interactive, just formatted JSON
  app.get("/spec", async (c) => {
    const doc = app.getOpenAPIDocument(openApiInfo);
    const json = JSON.stringify(doc, null, 2);
    return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>SNA API Spec</title>
<style>body{margin:0;background:#1a1a2e;color:#e0e0e0;font-family:monospace}pre{padding:20px;overflow:auto;font-size:12px;line-height:1.6}a{color:#7ec699}</style></head>
<body><pre>${json.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
<a href="/docs">Swagger UI</a> · <a href="/openapi.json">Raw JSON</a></pre></body></html>`);
  });

  // Health check
  app.openapi(healthRoute, (c) => c.json({ ok: true, name: "sna", version: "1" }));

  // SNA port
  app.openapi(snaPortRoute, (c) => {
    const portFile = path.join(process.cwd(), ".sna", "sna-api.port");
    try {
      const port = fs.readFileSync(portFile, "utf8").trim();
      return c.json({ port: parseInt(port, 10) }, 200);
    } catch {
      return c.json({ port: null, error: "SNA API not running" }, 503);
    }
  }) as any;

  // ── Session CRUD ──────────────────────────────────────────────

  const sessionManager = options?.sessionManager;

  app.openapi(createSessionRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const body = c.req.valid("json");
    try {
      const session = sessionManager.createSession({
        id: body.id,
        label: body.label,
        cwd: body.cwd,
        meta: body.meta,
      });
      logger.log("route", `POST /sessions → created "${session.id}"`);
      return c.json({ status: "created", sessionId: session.id, label: session.label, meta: session.meta }, 200);
    } catch (e: any) {
      logger.err("err", `POST /sessions → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 409);
    }
  });

  app.openapi(listSessionsRoute, (c) => {
    if (!sessionManager) return c.json({ sessions: [] }, 200);
    const { include } = c.req.valid("query");
    return c.json({
      sessions: sessionManager.listSessions({ includeRuntimeChain: include === "chain" }),
    }, 200);
  });

  app.openapi(removeSessionRoute, (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const { id } = c.req.valid("param");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot remove default session" }, 400);
    }
    const removed = sessionManager.removeSession(id);
    if (!removed) {
      return c.json({ status: "error", message: "Session not found" }, 404);
    }
    logger.log("route", `DELETE /sessions/${id} → removed`);
    return c.json({ status: "removed" }, 200);
  });

  app.openapi(updateSessionRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      sessionManager.updateSession(id, { label: body.label, meta: body.meta, cwd: body.cwd });
      logger.log("route", `PATCH /sessions/${id} → updated`);
      return c.json({ status: "updated", session: id }, 200);
    } catch (e: any) {
      logger.err("err", `PATCH /sessions/${id} → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 404);
    }
  });

  // ── Agent Lifecycle ───────────────────────────────────────────

  app.openapi(startRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");

    const session = sessionManager.getOrCreateSession(sessionId, { cwd: body.cwd });

    if (session.process?.alive && !body.force) {
      logger.log("route", `POST /start?session=${sessionId} → already_running`);
      return c.json({
        status: "already_running",
        provider: getConfig().defaultProvider,
        sessionId: session.process.sessionId ?? session.id,
      }, 200);
    }

    if (session.process?.alive) {
      session.process.kill();
    }

    const provider = getProvider(body.provider ?? getConfig().defaultProvider);

    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(sessionId, session.label ?? sessionId);
      if (body.prompt) {
        insertChatMessage(db, {
          sessionId, actor: "user", kind: "text",
          content: body.prompt,
          meta: body.meta,
        });
      }
    } catch { /* DB not ready — non-fatal */ }

    const providerName = body.provider ?? getConfig().defaultProvider;
    const model = body.model ?? getConfig().model;

    try {
      const proc = await spawnWithPool(provider, {
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode: body.permissionMode as any,
        configDir: body.configDir,
        env: { ...body.env, SNA_SESSION_ID: sessionId },
        history: body.history,
        extraArgs: body.extraArgs,
        providerOptions: body.providerOptions,
        systemPrompt: body.systemPrompt,
        appendSystemPrompt: body.appendSystemPrompt,
        allowedTools: body.allowedTools,
        disallowedTools: body.disallowedTools,
        mcpServers: body.mcpServers as any,
      });

      sessionManager.setProcess(sessionId, proc);
      sessionManager.saveStartConfig(sessionId, {
        provider: providerName,
        modelProvider: body.modelProvider,
        model,
        cwd: session.cwd,
        permissionMode: body.permissionMode,
        configDir: body.configDir,
        extraArgs: body.extraArgs,
        providerOptions: body.providerOptions,
      });
      logger.log("route", `POST /start?session=${sessionId} → started`);

      return c.json({
        status: "started",
        provider: provider.name,
        sessionId: session.id,
      }, 200);
    } catch (e: any) {
      logger.err("err", `POST /start?session=${sessionId} failed: ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  app.openapi(sendRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);

    if (!session?.process?.alive) {
      logger.err("err", `POST /send?session=${sessionId} → no active session`);
      return c.json(
        { status: "error", message: `No active agent session "${sessionId}". Call POST /start first.` },
        400,
      );
    }

    const body = c.req.valid("json");
    if (!body.message && !body.images?.length) {
      logger.err("err", `POST /send?session=${sessionId} → empty message`);
      return c.json({ status: "error", message: "message or images required" }, 400);
    }

    const userText = body.message ?? "";
    const meta: Record<string, unknown> = body.meta ? { ...body.meta } : {};
    const embeds: Record<string, EmbedRecord> = {};
    let contentText = userText;
    if (body.images?.length) {
      const saved = saveEmbeds(sessionId, body.images);
      const refs = saved.map(({ id, record }) => {
        embeds[id] = record;
        return formatEmbedRef(id);
      });
      contentText = userText ? `${userText}\n${refs.join(" ")}` : refs.join(" ");
    }
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(sessionId, session.label ?? sessionId);
      insertChatMessage(db, {
        sessionId,
        actor: "user",
        kind: "text",
        content: contentText,
        embeds: Object.keys(embeds).length > 0 ? embeds : undefined,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      });
    } catch { /* DB write failure is non-fatal */ }

    sessionManager.pushEvent(sessionId, {
      type: "user_message",
      message: contentText,
      data: Object.keys(meta).length > 0 ? meta : undefined,
      timestamp: Date.now(),
    });

    sessionManager.updateSessionState(sessionId, "processing");
    sessionManager.touch(sessionId);

    if (body.images?.length) {
      const content: ContentBlock[] = [
        ...body.images.map((img) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
        })),
        ...(body.message ? [{ type: "text" as const, text: body.message }] : []),
      ];
      session.process.send(content);
    } else {
      session.process.send(body.message!);
    }
    return c.json({ status: "sent" }, 200);
  });

  app.openapi(restartRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");

    try {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        // Restart-route's openapi schema only declares 200/500; surface this
        // as 500 to stay within the typed-response contract.
        return c.json({ status: "error", message: "Session not found" }, 500);
      }
      const prevProvider = session.config?.provider;
      const ccSessionId = session.ccSessionId;

      const nextProvider = body.provider ?? prevProvider ?? getConfig().defaultProvider;
      const nextProv = getProvider(nextProvider);

      const typedOpts = {
        systemPrompt: body.systemPrompt,
        appendSystemPrompt: body.appendSystemPrompt,
        allowedTools: body.allowedTools,
        disallowedTools: body.disallowedTools,
        mcpServers: body.mcpServers as any,
      };

      // Single path for both pooled and non-pooled: restartSession owns the
      // kill + persist mechanics; spawnWithPool handles the runtime pool
      // branch (no-op for non-pooled providers like claude-code). Earlier
      // versions had separate branches and the duplication caused #21's
      // openapi.ts regression — the helper closes that off.
      const { config } = await sessionManager.restartSession(sessionId, body, async (cfg) => {
        const prov = getProvider(cfg.provider);
        const providerChanged = prevProvider && cfg.provider !== prevProvider;

        if (providerChanged) {
          const history = buildCanonicalFromDb(sessionId);
          logger.log("route", `restart: provider changed ${prevProvider} → ${cfg.provider}, using DB history (${history.length} msgs)`);
          return spawnWithPool(prov, {
            cwd: session.cwd,
            model: cfg.model,
            permissionMode: cfg.permissionMode as any,
            configDir: cfg.configDir,
            env: { ...body.env, SNA_SESSION_ID: sessionId },
            history: history.length > 0 ? history : undefined,
            extraArgs: cfg.extraArgs,
            providerOptions: cfg.providerOptions,
            ...typedOpts,
          });
        }

        return spawnWithPool(prov, {
          cwd: session.cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode as any,
          configDir: cfg.configDir,
          env: { ...body.env, SNA_SESSION_ID: sessionId },
          resumeSessionId: ccSessionId ?? undefined,
          extraArgs: cfg.extraArgs,
          providerOptions: cfg.providerOptions,
          ...typedOpts,
        });
      });
      logger.log("route", `POST /restart?session=${sessionId} → restarted (${config.provider})`);
      return c.json({ status: "restarted", provider: config.provider, sessionId }, 200);
    } catch (e: any) {
      logger.err("err", `POST /restart?session=${sessionId} → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  app.openapi(resumeRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");

    const session = sessionManager.getOrCreateSession(sessionId);
    if (session.process?.alive) {
      return c.json({ status: "error", message: "Session already running. Use agent.send instead." }, 400);
    }

    const history = buildCanonicalFromDb(sessionId);
    if (history.length === 0 && !body.prompt) {
      return c.json({ status: "error", message: "No history in DB — nothing to resume." }, 400);
    }

    const providerName = body.provider ?? getConfig().defaultProvider;
    const providerChanged = session.config && session.config.provider !== providerName;
    const model = body.model ?? session.config?.model ?? getConfig().model;
    const permissionMode = body.permissionMode ?? session.config?.permissionMode;
    const configDir = providerChanged ? body.configDir : (body.configDir ?? session.config?.configDir);
    const extraArgs = providerChanged ? body.extraArgs : (body.extraArgs ?? session.config?.extraArgs);
    const providerOptions = providerChanged ? body.providerOptions : (body.providerOptions ?? session.config?.providerOptions);
    const modelProvider = body.modelProvider ?? (providerChanged ? undefined : session.config?.modelProvider);
    const provider = getProvider(providerName);

    try {
      const proc = await spawnWithPool(provider, {
        cwd: session.cwd,
        prompt: body.prompt,
        model,
        permissionMode: permissionMode as any,
        configDir,
        env: { ...body.env, SNA_SESSION_ID: sessionId },
        history: history.length > 0 ? history : undefined,
        extraArgs,
        providerOptions,
        systemPrompt: body.systemPrompt,
        appendSystemPrompt: body.appendSystemPrompt,
        allowedTools: body.allowedTools,
        disallowedTools: body.disallowedTools,
        mcpServers: body.mcpServers as any,
      });
      sessionManager.setProcess(sessionId, proc, "resumed");
      sessionManager.saveStartConfig(sessionId, {
        provider: providerName,
        modelProvider,
        model,
        cwd: session.cwd,
        permissionMode,
        configDir,
        extraArgs,
        providerOptions,
      });
      logger.log("route", `POST /resume?session=${sessionId} → resumed (${history.length} history msgs)`);
      return c.json({
        status: "resumed",
        provider: providerName,
        sessionId: session.id,
        historyCount: history.length,
      }, 200);
    } catch (e: any) {
      logger.err("err", `POST /resume?session=${sessionId} → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  app.openapi(interruptRoute, (c) => {
    if (!sessionManager) return c.json({ status: "no_session" }, 200);
    const sessionId = getSessionId(c);
    const interrupted = sessionManager.interruptSession(sessionId);
    return c.json({ status: interrupted ? "interrupted" : "no_session" }, 200);
  });

  app.openapi(setModelRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "no_session", model: "" }, 200);
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");
    const updated = sessionManager.setSessionModel(sessionId, body.model);
    return c.json({ status: updated ? "updated" : "no_session", model: body.model }, 200);
  });

  app.openapi(setPermissionModeRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "no_session", permissionMode: "" }, 200);
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");
    const updated = sessionManager.setSessionPermissionMode(sessionId, body.permissionMode);
    return c.json({ status: updated ? "updated" : "no_session", permissionMode: body.permissionMode }, 200);
  });

  app.openapi(sessionPatchRoute, async (c) => {
    if (!sessionManager) {
      return c.json({ status: "error" as const, message: "No session manager" }, 400);
    }
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");
    // SessionPatch fields only; unknown fields would have been stripped by Zod.
    const patch = {
      ...(body.cwd !== undefined ? { cwd: body.cwd } : {}),
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.permissionMode !== undefined ? { permissionMode: body.permissionMode } : {}),
    };

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ status: "error" as const, message: "Session not found" }, 404);
    }

    try {
      const result = await sessionManager.applySessionPatch(sessionId, patch, async (cfg) => {
        const prov = getProvider(cfg.provider);
        const history = buildCanonicalFromDb(sessionId);
        return spawnWithPool(prov, {
          cwd: cfg.cwd,
          model: cfg.model,
          permissionMode: cfg.permissionMode as any,
          configDir: cfg.configDir,
          env: { SNA_SESSION_ID: sessionId },
          history: history.length > 0 ? history : undefined,
          extraArgs: cfg.extraArgs,
          providerOptions: cfg.providerOptions,
        });
      });
      logger.log("route", `PATCH /agent/session?session=${sessionId} → ${result.applied} fields=[${result.fields.join(",")}] rt=${result.runtimeId}`);
      return c.json({
        status: "updated" as const,
        applied: result.applied,
        runtimeId: result.runtimeId,
        fields: result.fields,
      }, 200);
    } catch (e: any) {
      logger.err("err", `PATCH /agent/session?session=${sessionId} → ${e.message}`);
      return c.json({ status: "error" as const, message: e.message }, 400);
    }
  });

  app.openapi(killRoute, (c) => {
    if (!sessionManager) return c.json({ status: "no_session" }, 200);
    const sessionId = getSessionId(c);
    const killed = sessionManager.killSession(sessionId);
    return c.json({ status: killed ? "killed" : "no_session" }, 200);
  });

  app.openapi(statusRoute, (c) => {
    if (!sessionManager) {
      return c.json({
        alive: false,
        agentStatus: "disconnected" as const,
        sessionId: null,
        ccSessionId: null,
        eventCount: 0,
        messageCount: 0,
        lastMessage: null,
        config: null,
      }, 200);
    }
    const sessionId = getSessionId(c);
    const session = sessionManager.getSession(sessionId);
    const alive = session?.process?.alive ?? false;
    let messageCount = 0;
    let lastMessage: { actor: string; kind: string; content: string; created_at: string } | null = null;
    try {
      const db = getDb();
      const count = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?").get(sessionId) as any;
      messageCount = count?.c ?? 0;
      const last = db.prepare("SELECT actor, kind, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId) as any;
      if (last) lastMessage = { actor: last.actor, kind: last.kind, content: last.content, created_at: last.created_at };
    } catch {}
    return c.json({
      alive,
      agentStatus: !alive ? "disconnected" as const : (session?.state === "processing" ? "busy" as const : "idle" as const),
      sessionId: session?.process?.sessionId ?? null,
      ccSessionId: session?.ccSessionId ?? null,
      eventCount: session?.eventCounter ?? 0,
      messageCount,
      lastMessage,
      config: session?.config ?? null,
    }, 200);
  });

  // ── One-shot ──────────────────────────────────────────────────

  app.openapi(runOnceRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const body = c.req.valid("json");
    if (!body.message) {
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    try {
      const result = await runOnce(sessionManager, body as RunOnceOptions);
      return c.json(result, 200);
    } catch (e: any) {
      logger.err("err", `POST /agent/run-once → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  app.openapi(completionRoute, async (c) => {
    const body = c.req.valid("json");
    if (!body.prompt) {
      return c.json({ status: "error", message: "prompt is required" }, 400);
    }
    try {
      const result = await completion(body as CompletionOptions);
      return c.json(result, 200);
    } catch (e: any) {
      logger.err("err", `POST /completion → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  app.openapi(listModelsRoute, async (c) => {
    const body = c.req.valid("json");
    const runtime = body.runtime ?? "claude-code";
    let provider;
    try {
      provider = getProvider(runtime);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }
    if (!provider.listModels) {
      return c.json(
        {
          models: [],
          source: "static" as const,
          fetchedAt: Date.now(),
          error: `runtime "${runtime}" does not support model listing`,
        },
        200,
      );
    }
    try {
      const result = await provider.listModels(body.config);
      return c.json(result, 200);
    } catch (e: any) {
      logger.err("err", `POST /agent/list-models[${runtime}] → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // ── Agent Events SSE ──────────────────────────────────────────
  //
  // Pure HTTP equivalent of the WS `agent.subscribe` channel. Lets HTTP-only
  // clients (curl, fetch with ReadableStream, EventSource) tail a session
  // without taking a dependency on the WebSocket transport.
  app.openapi(agentEventsRoute, (c) => {
    if (!sessionManager) {
      return c.json({ status: "error", message: "SessionManager not provided" }, 500) as any;
    }
    const sessionId = getSessionId(c);
    const session = sessionManager.getOrCreateSession(sessionId);

    const sinceParam = c.req.query("since");
    const sinceCursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;

    return streamSSE(c, async (stream) => {
      const KEEPALIVE_MS = getConfig().keepaliveIntervalMs;
      const signal = c.req.raw.signal;

      const queue: Array<{ cursor: number; event: AgentEvent }> = [];
      let wakeUp: (() => void) | null = null;

      const unsub = sessionManager.onSessionEvent(sessionId, (eventCursor, event) => {
        queue.push({ cursor: eventCursor, event });
        const fn = wakeUp; wakeUp = null; fn?.();
      });
      signal.addEventListener("abort", () => { const fn = wakeUp; wakeUp = null; fn?.(); });

      try {
        let cursor = sinceCursor;
        if (cursor < session.eventCounter) {
          const startIdx = Math.max(
            0,
            session.eventBuffer.length - (session.eventCounter - cursor),
          );
          for (const event of session.eventBuffer.slice(startIdx)) {
            cursor++;
            await stream.writeSSE({ id: String(cursor), data: JSON.stringify(event) });
          }
        } else {
          cursor = session.eventCounter;
        }

        while (queue.length > 0 && queue[0].cursor !== -1 && queue[0].cursor <= cursor) {
          queue.shift();
        }

        while (!signal.aborted) {
          if (queue.length === 0) {
            await Promise.race([
              new Promise<void>((r) => { wakeUp = r; }),
              new Promise<void>((r) => setTimeout(r, KEEPALIVE_MS)),
            ]);
          }
          if (signal.aborted) break;

          if (queue.length > 0) {
            while (queue.length > 0) {
              const item = queue.shift()!;
              if (item.cursor === -1) {
                await stream.writeSSE({ data: JSON.stringify(item.event) });
              } else {
                await stream.writeSSE({ id: String(item.cursor), data: JSON.stringify(item.event) });
              }
            }
          } else {
            await stream.writeSSE({ data: "" });
          }
        }
      } finally {
        unsub();
      }
    });
  });

  // ── Permission ────────────────────────────────────────────────

  app.openapi(permissionRequestRoute, async (c) => {
    if (!sessionManager) return c.json({ approved: false }, 200);
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");
    logger.log("route", `POST /permission-request?session=${sessionId} → ${body.tool_name}`);
    const result = await sessionManager.createPendingPermission(sessionId, body);
    return c.json({ approved: result }, 200);
  });

  app.openapi(permissionRespondRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const sessionId = getSessionId(c);
    const body = c.req.valid("json");
    const approved = body.approved ?? false;

    const resolved = sessionManager.resolvePendingPermission(sessionId, approved);
    if (!resolved) {
      return c.json({ status: "error", message: "No pending permission request" }, 404);
    }

    logger.log("route", `POST /permission-respond?session=${sessionId} → ${approved ? "approved" : "denied"}`);
    return c.json({ status: approved ? "approved" : "denied" }, 200);
  });

  app.openapi(permissionPendingRoute, (c) => {
    if (!sessionManager) return c.json({ pending: [] }, 200);
    const sessionId = c.req.query("session");

    if (sessionId) {
      const pending = sessionManager.getPendingPermission(sessionId);
      return c.json({ pending: pending ? [{ sessionId, ...pending }] : [] }, 200);
    }

    return c.json({ pending: sessionManager.getAllPendingPermissions() }, 200);
  });

  // ── Chat Sessions ─────────────────────────────────────────────

  app.openapi(chatListSessionsRoute, (c) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, type, meta, cwd, created_at FROM chat_sessions ORDER BY created_at DESC`
      ).all() as { id: string; label: string; type: string; meta: string | null; cwd: string | null; created_at: string }[];
      const sessions = rows.map((r) => ({
        ...r,
        meta: r.meta ? JSON.parse(r.meta) : null,
      }));
      return c.json({ sessions }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  });

  app.openapi(chatCreateSessionRoute, async (c) => {
    const body = c.req.valid("json");
    const id = body.id ?? crypto.randomUUID().slice(0, 8);
    const sessionType = body.type ?? body.chatType ?? "background";
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`
      ).run(id, body.label ?? id, sessionType, body.meta ? JSON.stringify(body.meta) : null);
      return c.json({ status: "created", id, meta: body.meta ?? null }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  app.openapi(chatDeleteSessionRoute, (c) => {
    const { id } = c.req.valid("param");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot delete default session" }, 400);
    }
    try {
      const db = getDb();
      db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
      return c.json({ status: "deleted" }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // ── Chat Messages ─────────────────────────────────────────────

  app.openapi(chatListMessagesRoute, (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    try {
      const db = getDb();
      let sql = `SELECT * FROM chat_messages WHERE session_id = ?`;
      const params: (string | number)[] = [id];

      if (query.since) {
        sql += ` AND id > ?`;
        params.push(parseInt(query.since, 10));
      }

      sql += ` ORDER BY id ASC`;

      if (query.limit) {
        sql += ` LIMIT ?`;
        params.push(parseInt(query.limit, 10));
      }

      const messages = db.prepare(sql).all(...params);
      return c.json({ messages }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  }) as any;

  app.openapi(chatCreateMessageRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    if (!body.actor || !body.kind) {
      return c.json({ status: "error", message: "actor and kind are required" }, 400);
    }

    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(id, id);
      const msgId = insertChatMessage(db, {
        sessionId: id,
        actor: body.actor,
        kind: body.kind,
        content: body.content ?? "",
        embeds: body.embeds as Record<string, EmbedRecord> | undefined,
        meta: body.meta,
      });
      return c.json({ status: "created", id: msgId }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  }) as any;

  app.openapi(chatClearMessagesRoute, (c) => {
    const { id } = c.req.valid("param");
    try {
      const db = getDb();
      db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
      return c.json({ status: "cleared" }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // ── Image Serving ─────────────────────────────────────────────

  app.openapi(serveImageRoute, (c) => {
    const { sessionId, filename } = c.req.valid("param");
    const filePath = resolveImagePath(sessionId, filename);
    if (!filePath) {
      return c.json({ status: "error", message: "Image not found" }, 404);
    }
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    };
    const contentType = mimeMap[ext ?? ""] ?? "application/octet-stream";
    const data = require("fs").readFileSync(filePath);
    return new Response(data, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
  });

  return app;
}
