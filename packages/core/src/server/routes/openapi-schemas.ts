/**
 * Zod schemas for all SNA SDK HTTP API endpoints.
 * Used by both @hono/zod-openapi route definitions and runtime validation.
 */

import { z } from "zod";

// ── Shared enums ──────────────────────────────────────────────────────

export const sessionStateSchema = z.enum(["idle", "processing", "waiting", "permission"]);
export const agentStatusSchema = z.enum(["idle", "busy", "disconnected"]);
export const chatActorSchema = z.enum(["user", "assistant", "system"]);
export const chatKindSchema = z.enum(["text", "thinking", "tool_use", "tool_result", "status", "error"]);
export const lifecycleStateSchema = z.enum(["started", "resumed", "killed", "exited", "crashed", "restarted"]);

// ── Session schemas ───────────────────────────────────────────────────

export const CreateSessionInput = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  cwd: z.string().optional(),
  meta: z.record(z.string(), z.any()).optional(),
}).strict();

export const UpdateSessionInput = z.object({
  label: z.string().optional(),
  meta: z.record(z.string(), z.any()).optional(),
  cwd: z.string().optional(),
}).strict();

export const SessionIdParam = z.object({
  id: z.string(),
});

export const SessionQuery = z.object({
  session: z.string().optional(),
});

// ── StartConfig schemas ───────────────────────────────────────────────

export const StartConfigSchema = z.object({
  provider: z.string(),
  modelProvider: z.string().optional(),
  model: z.string(),
  permissionMode: z.string().optional(),
  configDir: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  providerOptions: z.record(z.string(), z.any()).optional(),
});

// ── Agent lifecycle schemas ───────────────────────────────────────────

export const StartInput = z.object({
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
}).strict();

export const SendInput = z.object({
  message: z.string().optional(),
  images: z.array(z.object({
    base64: z.string(),
    mimeType: z.string(),
  })).optional(),
  meta: z.record(z.string(), z.any()).optional(),
}).strict();

export const RestartInput = z.object({
  provider: z.string().optional(),
  modelProvider: z.string().optional(),
  model: z.string().optional(),
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
}).strict();

export const ResumeInput = z.object({
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
}).strict();

export const SetModelInput = z.object({
  model: z.string(),
}).strict();

export const SetPermissionModeInput = z.object({
  permissionMode: z.string(),
}).strict();

// ── Run-once / Completion schemas ─────────────────────────────────────

export const RunOnceInput = z.object({
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
}).strict();

export const CompletionInput = z.object({
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
}).strict();

// ── Permission schemas ────────────────────────────────────────────────

export const PermissionRequestInput = z.object({
  tool_name: z.string().optional(),
  tool_input: z.record(z.string(), z.any()).optional(),
}).strict();

export const PermissionRespondInput = z.object({
  approved: z.boolean(),
}).strict();

// ── Chat schemas ──────────────────────────────────────────────────────

export const CreateChatSessionInput = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  type: z.string().optional(),
  chatType: z.string().optional(),
  meta: z.record(z.string(), z.any()).optional(),
}).strict();

export const CreateChatMessageInput = z.object({
  actor: chatActorSchema,
  kind: chatKindSchema,
  content: z.string().optional(),
  embeds: z.record(z.string(), z.any()).optional(),
  meta: z.record(z.string(), z.any()).optional(),
}).strict();

// ── Response schemas ──────────────────────────────────────────────────

export const HealthResponse = z.object({
  ok: z.literal(true),
  name: z.literal("sna"),
  version: z.string(),
});

export const SessionCreatedResponse = z.object({
  status: z.literal("created"),
  sessionId: z.string(),
  label: z.string(),
  meta: z.record(z.string(), z.any()).nullable(),
});

export const SessionsListResponse = z.object({
  sessions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    alive: z.boolean(),
    state: sessionStateSchema,
    agentStatus: agentStatusSchema,
    cwd: z.string(),
    meta: z.record(z.string(), z.any()).nullable(),
    config: StartConfigSchema.nullable(),
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
  })),
});

export const SessionRemovedResponse = z.object({
  status: z.literal("removed"),
});

export const SessionUpdatedResponse = z.object({
  status: z.literal("updated"),
  session: z.string(),
});

export const AgentStartedResponse = z.object({
  status: z.enum(["started", "already_running"]),
  provider: z.string(),
  sessionId: z.string(),
});

export const AgentSentResponse = z.object({
  status: z.literal("sent"),
});

export const AgentRestartedResponse = z.object({
  status: z.literal("restarted"),
  provider: z.string(),
  sessionId: z.string(),
});

export const AgentResumedResponse = z.object({
  status: z.literal("resumed"),
  provider: z.string(),
  sessionId: z.string(),
  historyCount: z.number(),
});

export const AgentInterruptedResponse = z.object({
  status: z.enum(["interrupted", "no_session"]),
});

export const AgentSetModelResponse = z.object({
  status: z.enum(["updated", "no_session"]),
  model: z.string(),
});

export const AgentSetPermissionModeResponse = z.object({
  status: z.enum(["updated", "no_session"]),
  permissionMode: z.string(),
});

export const AgentKilledResponse = z.object({
  status: z.enum(["killed", "no_session"]),
});

export const AgentStatusResponse = z.object({
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
  config: StartConfigSchema.nullable(),
});

export const RunOnceResponse = z.object({
  result: z.string(),
  usage: z.record(z.string(), z.any()).nullable(),
});

export const CompletionResponse = z.object({
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
});

export const PermissionRespondResultResponse = z.object({
  status: z.enum(["approved", "denied"]),
});

export const PermissionPendingResponse = z.object({
  pending: z.array(z.object({
    sessionId: z.string(),
    request: z.record(z.string(), z.any()),
    createdAt: z.number(),
  })),
});

export const ChatSessionsListResponse = z.object({
  sessions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.string(),
    meta: z.string().nullable(),
    cwd: z.string().nullable(),
    created_at: z.string(),
  })),
});

export const ChatSessionCreatedResponse = z.object({
  status: z.literal("created"),
  id: z.string(),
  meta: z.record(z.string(), z.any()).nullable(),
});

export const ChatSessionDeletedResponse = z.object({
  status: z.literal("deleted"),
});

export const ChatMessagesListResponse = z.object({
  messages: z.array(z.any()),
});

export const ChatMessageCreatedResponse = z.object({
  status: z.literal("created"),
  id: z.number(),
});

export const ChatMessagesClearedResponse = z.object({
  status: z.literal("cleared"),
});

export const SnaPortResponse = z.object({
  port: z.number().nullable(),
  error: z.string().optional(),
});

// ── Error response (used across all endpoints) ────────────────────────

export const ErrorResponse = z.object({
  status: z.literal("error"),
  message: z.string(),
  stack: z.string().optional(),
});
