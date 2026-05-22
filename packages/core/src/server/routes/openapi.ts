/**
 * OpenAPI route definitions for SNA SDK using @hono/zod-openapi.
 *
 * Uses createRoute() + OpenAPIHono.openapi() pattern for typed, auto-documenting endpoints.
 * Zod schemas validate requests and generate OpenAPI spec automatically.
 */

import { OpenAPIHono, createRoute, z, type RouteConfig } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { streamSSE } from "hono/streaming";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import {
  getProvider,
  listProviders,
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
import { configuredAppMeta, getConfig, withConfiguredAppId } from "../../config.js";
import { completion, type CompletionOptions } from "../../core/completion.js";
import type { ContentBlock } from "../../core/providers/types.js";
import { resolveImagePath } from "../image-store.js";
import { runOnce, type RunOnceOptions } from "../run-once.js";
import { getAdminAsset, renderAdminPage } from "../admin-ui.js";
import {
  approvePkceRequest,
  createPkceRequest,
  denyPkceRequest,
  exchangeAuthorizationCode,
  getPkceRequest,
  listPkceRequests,
  refreshAccessToken,
  revokeToken,
} from "../auth.js";
import { createHttpSecurityMiddleware, type SnaAuthIdentity, type SnaSecurityOptions } from "../security.js";
import {
  buildAgentAudit,
  listModelPresets,
  listRegisteredRuntimes,
  listRuntimeProfiles,
  resolveLaunchConfig,
  upsertModelPreset,
  upsertRegisteredRuntime,
  upsertRuntimeProfile,
} from "../runtime-settings.js";

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

const PkceStartInputSchema = z.object({
  clientId: z.string(),
  displayName: z.string().optional(),
  redirectUri: z.string().optional(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.literal("S256").optional(),
  scopes: z.array(z.string()).optional(),
}).strict();

const PkceTokenInputSchema = z.union([
  z.object({
    grantType: z.literal("authorization_code"),
    requestId: z.string(),
    code: z.string(),
    codeVerifier: z.string(),
  }).strict(),
  z.object({
    grantType: z.literal("refresh_token"),
    refreshToken: z.string(),
  }).strict(),
]);

const RevokeTokenInputSchema = z.object({
  token: z.string(),
}).strict();

const PkceRequestInfoSchema = z.object({
  requestId: z.string(),
  clientId: z.string(),
  displayName: z.string().nullable(),
  redirectUri: z.string().nullable(),
  scopes: z.array(z.string()),
  status: z.enum(["pending", "approved", "consumed", "expired", "denied"]),
  code: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  approvedAt: z.number().nullable(),
});

const PkceStartResponseSchema = PkceRequestInfoSchema.extend({
  authorizeUrl: z.string(),
});

const AuthTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number(),
  refreshExpiresIn: z.number(),
  scopes: z.array(z.string()),
});

const RevokeTokenResponseSchema = z.object({
  revoked: z.boolean(),
});

const SessionConfigSchema = z.object({
  provider: z.string(),
  modelProvider: z.string().optional(),
  model: z.string(),
  cwd: z.string(),
  permissionMode: z.string().optional(),
  profileLevel: z.number().int().min(1).max(5).optional(),
  runtimeId: z.string().optional(),
  modelPresetId: z.string().optional(),
  reasoningLevel: z.number().int().min(0).max(5).optional(),
  configDir: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  providerOptions: z.record(z.string(), z.any()).optional(),
});

const RuntimeLaunchConfigSchema = z.object({
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
  env: z.record(z.string(), z.string()).optional(),
  reasoningLevel: z.number().int().min(0).max(5).optional(),
}).strict();

const RegisteredRuntimeSchema = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  modelProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  cliPath: z.string().optional(),
  models: z.array(z.object({
    id: z.string(),
    label: z.string().optional(),
    provider: z.string().optional(),
  })).optional(),
  config: RuntimeLaunchConfigSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const RuntimeCatalogEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
  supportsRuntimePooling: z.boolean(),
  supportsCwdPerThread: z.boolean(),
  modelListing: z.boolean(),
  detection: z.object({
    detected: z.boolean(),
    path: z.string(),
    version: z.string().optional(),
    source: z.enum(["env", "cache", "static", "shell", "fallback"]),
    message: z.string().optional(),
  }),
});

const RuntimeProfileSchema = z.object({
  level: z.number().int().min(1).max(5),
  label: z.string(),
  description: z.string(),
  runtimeId: z.string().optional(),
  modelPresetId: z.string().optional(),
  config: RuntimeLaunchConfigSchema,
  updatedAt: z.number().optional(),
});

const ModelPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  runtimeId: z.string(),
  model: z.string().optional(),
  modelProvider: z.string().optional(),
  reasoningLevel: z.number().int().min(0).max(5),
  createdAt: z.number(),
  updatedAt: z.number(),
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

const UnauthorizedResponse = {
  description: "Authentication required.",
  content: { "application/json": { schema: ErrorResponse } },
} as const;

const ForbiddenResponse = {
  description: "Origin not allowed.",
  content: { "application/json": { schema: ErrorResponse } },
} as const;

const bearerAuthSecurityScheme = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "SNA auth token",
} as const;

function withOpenApiSecurity(config: any) {
  return {
    ...config,
    components: {
      ...config.components,
      securitySchemes: {
        ...config.components?.securitySchemes,
        bearerAuth: bearerAuthSecurityScheme,
      },
    },
    security: config.security ?? [{ bearerAuth: [] }],
  };
}

function applyOpenApiSecurity(document: any) {
  document.components ??= {};
  document.components.securitySchemes = {
    ...document.components.securitySchemes,
    bearerAuth: bearerAuthSecurityScheme,
  };
  document.security ??= [{ bearerAuth: [] }];
  return document;
}

function protectedRoute<const P extends string, R extends Omit<RouteConfig, "path"> & { path: P }>(routeConfig: R) {
  return createRoute({
    ...routeConfig,
    security: [{ bearerAuth: [] }],
    responses: {
      401: UnauthorizedResponse,
      403: ForbiddenResponse,
      ...routeConfig.responses,
    },
  });
}

// ── Health ────────────────────────────────────────────────────────────

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  security: [],
  summary: "Health check",
  description: "Verify the SNA server is running.",
  responses: {
    200: {
      description: "Server is healthy.",
      content: { "application/json": { schema: z.object({ ok: z.literal(true), name: z.literal("sna"), version: z.string() }) } },
    },
  },
});

// ── Local Authorization ───────────────────────────────────────────────

const pkceStartRoute = createRoute({
  method: "post",
  path: "/auth/pkce/start",
  security: [],
  summary: "Start local PKCE authorization",
  description: "Create a pending local authorization request for a consumer app. The owner approves it through the local admin UI.",
  request: {
    body: {
      content: { "application/json": { schema: PkceStartInputSchema } },
    },
  },
  responses: {
    201: {
      description: "Authorization request created.",
      content: { "application/json": { schema: PkceStartResponseSchema } },
    },
    400: {
      description: "Invalid authorization request.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const pkceRequestRoute = createRoute({
  method: "get",
  path: "/auth/pkce/requests/{id}",
  security: [],
  summary: "Poll local PKCE authorization request",
  description: "Read a single authorization request. Approved requests include a short-lived authorization code.",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Authorization request.",
      content: { "application/json": { schema: PkceRequestInfoSchema } },
    },
    404: {
      description: "Authorization request not found.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const pkceRequestsListRoute = protectedRoute({
  method: "get",
  path: "/auth/pkce/requests",
  summary: "List pending local authorization requests",
  description: "Owner-only list of pending and approved authorization requests for the local admin UI.",
  responses: {
    200: {
      description: "Authorization request list.",
      content: { "application/json": { schema: z.object({ requests: z.array(PkceRequestInfoSchema) }) } },
    },
    403: {
      description: "Owner token required.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const pkceApproveRoute = protectedRoute({
  method: "post",
  path: "/auth/pkce/requests/{id}/approve",
  summary: "Approve local PKCE authorization request",
  description: "Owner-only approval endpoint. Returns an authorization code that the requesting app exchanges with its PKCE verifier.",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Authorization request approved.",
      content: { "application/json": { schema: PkceRequestInfoSchema } },
    },
    400: {
      description: "Authorization request cannot be approved.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    403: {
      description: "Owner token required.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const pkceDenyRoute = protectedRoute({
  method: "post",
  path: "/auth/pkce/requests/{id}/deny",
  summary: "Deny local PKCE authorization request",
  description: "Owner-only denial endpoint for a pending authorization request.",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Authorization request denied.",
      content: { "application/json": { schema: PkceRequestInfoSchema } },
    },
    400: {
      description: "Authorization request cannot be denied.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    403: {
      description: "Owner token required.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const pkceTokenRoute = createRoute({
  method: "post",
  path: "/auth/pkce/token",
  security: [],
  summary: "Exchange local PKCE authorization grant",
  description: "Exchange an approved authorization code or refresh token for a client access token.",
  request: {
    body: {
      content: { "application/json": { schema: PkceTokenInputSchema } },
    },
  },
  responses: {
    200: {
      description: "Client token issued.",
      content: { "application/json": { schema: AuthTokenResponseSchema } },
    },
    400: {
      description: "Invalid authorization grant.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const revokeTokenRoute = protectedRoute({
  method: "post",
  path: "/auth/revoke",
  summary: "Revoke local client token",
  description: "Revoke an access or refresh token issued by the local daemon.",
  request: {
    body: {
      content: { "application/json": { schema: RevokeTokenInputSchema } },
    },
  },
  responses: {
    200: {
      description: "Token revocation result.",
      content: { "application/json": { schema: RevokeTokenResponseSchema } },
    },
    400: {
      description: "Invalid revocation request.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// ── SNA Port ──────────────────────────────────────────────────────────

const snaPortRoute = protectedRoute({
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

const createSessionRoute = protectedRoute({
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

const listSessionsRoute = protectedRoute({
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

const removeSessionRoute = protectedRoute({
  method: "delete",
  path: "/agent/sessions/{id}",
  summary: "Remove a session",
  description: "Remove an agent session, its persisted history, its runtime chain, and any pending permission request. Cannot remove 'default'.",
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

const updateSessionRoute = protectedRoute({
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

// ── Runtime Settings ─────────────────────────────────────────────────

const runtimeCatalogRoute = protectedRoute({
  method: "get",
  path: "/agent/runtime-catalog",
  summary: "List supported runtimes",
  description: "List SNA-supported agent runtimes that can be selected when registering daemon runtime profiles.",
  responses: {
    200: {
      description: "Supported runtimes.",
      content: { "application/json": { schema: z.object({ runtimes: z.array(RuntimeCatalogEntrySchema) }) } },
    },
  },
});

const listRuntimesRoute = protectedRoute({
  method: "get",
  path: "/agent/runtimes",
  summary: "List registered runtimes",
  description: "List daemon-level runtime registrations used by difficulty profiles.",
  responses: {
    200: {
      description: "Registered runtimes.",
      content: { "application/json": { schema: z.object({ runtimes: z.array(RegisteredRuntimeSchema) }) } },
    },
  },
});

const upsertRuntimeRoute = protectedRoute({
  method: "put",
  path: "/agent/runtimes/{id}",
  summary: "Register runtime",
  description: "Create or update a named runtime registration. Consumers can reference it through profile levels.",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: z.object({
        provider: z.string(),
        label: z.string().optional(),
        enabled: z.boolean().optional(),
        modelProvider: z.string().optional(),
        defaultModel: z.string().optional(),
        cliPath: z.string().optional(),
        models: z.array(z.object({
          id: z.string(),
          label: z.string().optional(),
          provider: z.string().optional(),
        })).optional(),
        config: RuntimeLaunchConfigSchema.optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Runtime registered.",
      content: { "application/json": { schema: z.object({ status: z.literal("registered"), runtime: RegisteredRuntimeSchema }) } },
    },
    400: {
      description: "Invalid runtime registration.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const listProfilesRoute = protectedRoute({
  method: "get",
  path: "/agent/profiles",
  summary: "List difficulty profiles",
  description: "List the five daemon-level task difficulty profiles. Consumers may pass `profileLevel` to lifecycle calls instead of duplicating runtime settings.",
  responses: {
    200: {
      description: "Difficulty profiles.",
      content: { "application/json": { schema: z.object({ profiles: z.array(RuntimeProfileSchema) }) } },
    },
  },
});

const listModelPresetsRoute = protectedRoute({
  method: "get",
  path: "/agent/model-presets",
  summary: "List model presets",
  description: "List named model presets that can be assigned to difficulty levels.",
  responses: {
    200: {
      description: "Model presets.",
      content: { "application/json": { schema: z.object({ presets: z.array(ModelPresetSchema) }) } },
    },
  },
});

const upsertModelPresetRoute = protectedRoute({
  method: "put",
  path: "/agent/model-presets/{id}",
  summary: "Save model preset",
  description: "Create or update a named model preset with runtime, model, and reasoning effort.",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: z.object({
        name: z.string().optional(),
        runtimeId: z.string(),
        model: z.string().optional(),
        modelProvider: z.string().optional(),
        reasoningLevel: z.number().int().min(0).max(5),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Model preset saved.",
      content: { "application/json": { schema: z.object({ status: z.literal("saved"), preset: ModelPresetSchema }) } },
    },
    400: {
      description: "Invalid model preset.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const upsertProfileRoute = protectedRoute({
  method: "put",
  path: "/agent/profiles/{level}",
  summary: "Update difficulty profile",
  description: "Update one of the five difficulty profile slots.",
  request: {
    params: z.object({ level: z.string().regex(/^[1-5]$/) }),
    body: {
      content: { "application/json": { schema: z.object({
        label: z.string().optional(),
        description: z.string().optional(),
        runtimeId: z.string().nullable().optional(),
        modelPresetId: z.string().nullable().optional(),
        config: RuntimeLaunchConfigSchema.optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description: "Profile updated.",
      content: { "application/json": { schema: z.object({ status: z.literal("updated"), profile: RuntimeProfileSchema }) } },
    },
    400: {
      description: "Invalid profile update.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const auditRoute = protectedRoute({
  method: "get",
  path: "/agent/audit",
  summary: "Agent audit",
  description: "Return registered runtimes, difficulty profiles, live session audit data, and app/client attribution data.",
  responses: {
    200: {
      description: "Audit snapshot.",
      content: { "application/json": { schema: z.object({
        profiles: z.array(RuntimeProfileSchema),
        modelPresets: z.array(ModelPresetSchema),
        runtimes: z.array(RegisteredRuntimeSchema.extend({
          activeSessionCount: z.number(),
          sessionCount: z.number(),
        })),
        sessions: z.array(SessionInfoSchema),
        apps: z.array(z.object({
          appId: z.string(),
          displayName: z.string().nullable(),
          scopes: z.array(z.string()),
          tokenCount: z.number(),
          activeTokenCount: z.number(),
          sessionCount: z.number(),
          lastUsedAt: z.number().nullable(),
        })),
      }) } },
    },
  },
});

// ── Agent Lifecycle ───────────────────────────────────────────────────

const startRoute = protectedRoute({
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
        profileLevel: z.number().int().min(1).max(5).optional(),
        runtimeId: z.string().optional(),
        modelPresetId: z.string().optional(),
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
        reasoningLevel: z.number().int().min(0).max(5).optional(),
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
    400: {
      description: "Invalid profile or runtime reference.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Start failed.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const sendRoute = protectedRoute({
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

const restartRoute = protectedRoute({
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
        profileLevel: z.number().int().min(1).max(5).optional(),
        runtimeId: z.string().optional(),
        modelPresetId: z.string().optional(),
        model: z.string().optional(),
        cwd: z.string().optional(),
        permissionMode: z.string().optional(),
        configDir: z.string().optional(),
        extraArgs: z.array(z.string()).optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        reasoningLevel: z.number().int().min(0).max(5).optional(),
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
    400: {
      description: "Invalid profile or runtime reference.",
      content: { "application/json": { schema: ErrorResponse } },
    },
    500: {
      description: "Restart failed.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const resumeRoute = protectedRoute({
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
        profileLevel: z.number().int().min(1).max(5).optional(),
        runtimeId: z.string().optional(),
        modelPresetId: z.string().optional(),
        extraArgs: z.array(z.string()).optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        reasoningLevel: z.number().int().min(0).max(5).optional(),
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

const interruptRoute = protectedRoute({
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

const setModelRoute = protectedRoute({
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

const setPermissionModeRoute = protectedRoute({
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

const sessionPatchRoute = protectedRoute({
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

const killRoute = protectedRoute({
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

const statusRoute = protectedRoute({
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

const runOnceRoute = protectedRoute({
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
        reasoningLevel: z.number().int().min(0).max(5).optional(),
        permissionMode: z.string().optional(),
        cwd: z.string().optional(),
        timeout: z.number().optional(),
        provider: z.string().optional(),
        profileLevel: z.number().int().min(1).max(5).optional(),
        runtimeId: z.string().optional(),
        modelPresetId: z.string().optional(),
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

const runOnceStreamRoute = protectedRoute({
  method: "post",
  path: "/agent/run-once/stream",
  summary: "Run once (SSE stream)",
  description:
    "Same one-shot lifecycle as `POST /agent/run-once`, but streams every `AgentEvent` produced by the run as a Server-Sent Events feed instead of buffering until completion. The stream ends after the run's terminal `complete` or `error` event (the server closes the connection). Consumers can render token-by-token UI without joining the full session machinery.",
  request: {
    body: {
      content: { "application/json": { schema: z.object({
        message: z.string(),
        model: z.string().optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        reasoningLevel: z.number().int().min(0).max(5).optional(),
        permissionMode: z.string().optional(),
        cwd: z.string().optional(),
        timeout: z.number().optional(),
        provider: z.string().optional(),
        profileLevel: z.number().int().min(1).max(5).optional(),
        runtimeId: z.string().optional(),
        modelPresetId: z.string().optional(),
        extraArgs: z.array(z.string()).optional(),
        env: z.record(z.string(), z.any()).optional(),
        providerOptions: z.record(z.string(), z.any()).optional(),
      }).strict() }},
    },
  },
  responses: {
    200: {
      description:
        "Open SSE stream. Each `data:` line is a JSON-encoded AgentEvent (assistant, assistant_delta, tool_use, tool_use_delta, complete, error, ...). The connection closes after the terminal event.",
      content: {
        "text/event-stream": {
          schema: z
            .string()
            .describe("SSE feed of AgentEvent objects, one per `data:` line."),
        },
      },
    },
    400: {
      description: "Missing message.",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const completionRoute = protectedRoute({
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
        profileLevel: z.number().int().min(1).max(5).optional(),
        runtimeId: z.string().optional(),
        modelPresetId: z.string().optional(),
        systemPrompt: z.string().optional(),
        appendSystemPrompt: z.string().optional(),
        reasoningLevel: z.number().int().min(0).max(5).optional(),
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

const permissionRequestRoute = protectedRoute({
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

const permissionRespondRoute = protectedRoute({
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

const listModelsRoute = protectedRoute({
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

const agentEventsRoute = protectedRoute({
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

const permissionPendingRoute = protectedRoute({
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

const chatListSessionsRoute = protectedRoute({
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

const chatCreateSessionRoute = protectedRoute({
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

const chatDeleteSessionRoute = protectedRoute({
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

const chatListMessagesRoute = protectedRoute({
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

const chatCreateMessageRoute = protectedRoute({
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

const chatClearMessagesRoute = protectedRoute({
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

const serveImageRoute = protectedRoute({
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

function requireOwner(c: any): true | Response {
  const identity = c.get?.("snaAuth") as SnaAuthIdentity | undefined;
  if (identity?.type === "owner") return true;
  return c.json({ status: "error", message: "Owner token required" }, 403);
}

export async function createOpenApiApp(options?: { sessionManager?: SessionManager } & SnaSecurityOptions) {
  const app = new OpenAPIHono();
  const getOpenAPIDocument = app.getOpenAPIDocument.bind(app);
  app.getOpenAPIDocument = ((objectConfig: any, generatorConfig?: any) =>
    applyOpenApiSecurity(getOpenAPIDocument(withOpenApiSecurity(objectConfig), generatorConfig))) as typeof app.getOpenAPIDocument;
  const getOpenAPI31Document = app.getOpenAPI31Document.bind(app);
  app.getOpenAPI31Document = ((objectConfig: any, generatorConfig?: any) =>
    applyOpenApiSecurity(getOpenAPI31Document(withOpenApiSecurity(objectConfig), generatorConfig))) as typeof app.getOpenAPI31Document;
  app.use("*", createHttpSecurityMiddleware(options ?? {}));

  const openApiInfo = {
    openapi: "3.1.0" as const,
    info: {
      title: "SNA SDK API",
      version: SNA_VERSION,
      description: "Skills-Native Application SDK — HTTP API for spawning and communicating with AI agent providers (Claude Code, Codex, OpenCode).",
    },
    components: {
      securitySchemes: {
        bearerAuth: bearerAuthSecurityScheme,
      },
    },
    security: [{ bearerAuth: [] }],
  };

  // Swagger UI — accessible at /docs
  app.doc("/openapi.json", openApiInfo);

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  app.get("/admin/assets/*", (c) => {
    const asset = getAdminAsset(new URL(c.req.url).pathname);
    if (!asset) return c.text("Not found", 404);
    c.header("Content-Type", asset.contentType);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(asset.content as any);
  });

  app.get("/admin", (c) => c.html(renderAdminPage()));
  app.get("/admin/*", (c) => c.html(renderAdminPage()));

  app.openapi(pkceStartRoute, (c) => {
    const body = c.req.valid("json");
    try {
      const request = createPkceRequest(body);
      const origin = new URL(c.req.url).origin;
      return (c as any).json({
        ...request,
        authorizeUrl: `${origin}/admin/authorization?request=${encodeURIComponent(request.requestId)}`,
      }, 201);
    } catch (err: any) {
      return (c as any).json({ status: "error", message: err.message }, 400);
    }
  });

  app.openapi(pkceRequestRoute, (c) => {
    const { id } = c.req.valid("param");
    const request = getPkceRequest(id);
    if (!request) return (c as any).json({ status: "error", message: "Authorization request not found" }, 404);
    return (c as any).json(request);
  });

  app.openapi(pkceRequestsListRoute, (c) => {
    const owner = requireOwner(c);
    if (owner !== true) return owner as any;
    return (c as any).json({ requests: listPkceRequests() });
  });

  app.openapi(pkceApproveRoute, (c) => {
    const owner = requireOwner(c);
    if (owner !== true) return owner as any;
    const { id } = c.req.valid("param");
    try {
      return (c as any).json(approvePkceRequest(id));
    } catch (err: any) {
      return (c as any).json({ status: "error", message: err.message }, 400);
    }
  });

  app.openapi(pkceDenyRoute, (c) => {
    const owner = requireOwner(c);
    if (owner !== true) return owner as any;
    const { id } = c.req.valid("param");
    try {
      return (c as any).json(denyPkceRequest(id));
    } catch (err: any) {
      return (c as any).json({ status: "error", message: err.message }, 400);
    }
  });

  app.openapi(pkceTokenRoute, (c) => {
    const body = c.req.valid("json");
    try {
      if (body.grantType === "authorization_code") {
        return (c as any).json(exchangeAuthorizationCode(body));
      }
      return (c as any).json(refreshAccessToken(body.refreshToken));
    } catch (err: any) {
      return (c as any).json({ status: "error", message: err.message }, 400);
    }
  });

  app.openapi(revokeTokenRoute, (c) => {
    const body = c.req.valid("json");
    return (c as any).json({ revoked: revokeToken(body.token) });
  });

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
        meta: withConfiguredAppId(body.meta, { includeWhenMissing: true }),
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
      sessionManager.updateSession(id, {
        label: body.label,
        meta: body.meta !== undefined ? withConfiguredAppId(body.meta) as Record<string, unknown> : undefined,
        cwd: body.cwd,
      });
      logger.log("route", `PATCH /sessions/${id} → updated`);
      return c.json({ status: "updated", session: id }, 200);
    } catch (e: any) {
      logger.err("err", `PATCH /sessions/${id} → ${e.message}`);
      return c.json({ status: "error", message: e.message }, 404);
    }
  });

  // ── Runtime Settings ─────────────────────────────────────────

  app.openapi(runtimeCatalogRoute, async (c) => {
    return c.json({ runtimes: await listProviders() }, 200);
  });

  app.openapi(listRuntimesRoute, (c) => {
    return c.json({ runtimes: listRegisteredRuntimes() }, 200);
  });

  app.openapi(upsertRuntimeRoute, (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      return c.json({ status: "registered" as const, runtime: upsertRegisteredRuntime(id, body as any) }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }
  });

  app.openapi(listProfilesRoute, (c) => {
    return c.json({ profiles: listRuntimeProfiles() }, 200);
  });

  app.openapi(listModelPresetsRoute, (c) => {
    return c.json({ presets: listModelPresets() }, 200);
  });

  app.openapi(upsertModelPresetRoute, (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      return c.json({ status: "saved" as const, preset: upsertModelPreset(id, body as any) }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }
  });

  app.openapi(upsertProfileRoute, (c) => {
    const { level } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      return c.json({ status: "updated" as const, profile: upsertRuntimeProfile(Number(level), body as any) }, 200);
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }
  });

  app.openapi(auditRoute, (c) => {
    if (!sessionManager) {
      return c.json(buildAgentAudit([]), 200);
    }
    return c.json(buildAgentAudit(sessionManager.listSessions({ includeRuntimeChain: true })), 200);
  });

  // ── Agent Lifecycle ───────────────────────────────────────────

  app.openapi(startRoute, async (c) => {
    if (!sessionManager) return c.json({ status: "error", message: "SessionManager not provided" }, 500);
    const sessionId = getSessionId(c);
    let body = c.req.valid("json");
    try {
      body = resolveLaunchConfig(body as any) as typeof body;
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }

    const session = sessionManager.getOrCreateSession(sessionId, { cwd: body.cwd, meta: configuredAppMeta() });

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
        reasoningLevel: body.reasoningLevel as (0 | 1 | 2 | 3 | 4 | 5) | undefined,
      });

      sessionManager.setProcess(sessionId, proc);
      sessionManager.saveStartConfig(sessionId, {
        provider: providerName,
        modelProvider: body.modelProvider,
        model,
        cwd: session.cwd,
        permissionMode: body.permissionMode,
        profileLevel: body.profileLevel as (1 | 2 | 3 | 4 | 5) | undefined,
        runtimeId: body.runtimeId,
        modelPresetId: body.modelPresetId,
        reasoningLevel: body.reasoningLevel as (0 | 1 | 2 | 3 | 4 | 5) | undefined,
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
    let body = c.req.valid("json");
    try {
      body = resolveLaunchConfig(body as any) as typeof body;
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }

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
      const { config } = await sessionManager.restartSession(sessionId, body as Partial<SessionConfig>, async (cfg) => {
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
            reasoningLevel: cfg.reasoningLevel,
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
          reasoningLevel: cfg.reasoningLevel,
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
    let body = c.req.valid("json");
    try {
      body = resolveLaunchConfig(body as any) as typeof body;
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }

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
        reasoningLevel: body.reasoningLevel as (0 | 1 | 2 | 3 | 4 | 5) | undefined,
      });
      sessionManager.setProcess(sessionId, proc, "resumed");
      sessionManager.saveStartConfig(sessionId, {
        provider: providerName,
        modelProvider,
        model,
        cwd: session.cwd,
        permissionMode,
        profileLevel: body.profileLevel as (1 | 2 | 3 | 4 | 5) | undefined,
        runtimeId: body.runtimeId,
        modelPresetId: body.modelPresetId,
        reasoningLevel: body.reasoningLevel as (0 | 1 | 2 | 3 | 4 | 5) | undefined,
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
    let body = c.req.valid("json");
    try {
      body = resolveLaunchConfig(body as any) as typeof body;
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }
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

  app.openapi(runOnceStreamRoute, (c) => {
    if (!sessionManager) {
      return c.json({ status: "error", message: "SessionManager not provided" }, 500) as any;
    }
    let body = c.req.valid("json");
    try {
      body = resolveLaunchConfig(body as any) as typeof body;
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400) as any;
    }
    if (!body.message) {
      return c.json({ status: "error", message: "message is required" }, 400);
    }

    return streamSSE(c, async (stream) => {
      const signal = c.req.raw.signal;

      // Queue every event the run produces, then drain to the SSE
      // stream below. We can't `await` inside the onEvent callback
      // (sessionManager dispatches synchronously), so we decouple
      // production from consumption.
      const queue: AgentEvent[] = [];
      let wakeUp: (() => void) | null = null;
      const wake = () => { const fn = wakeUp; wakeUp = null; fn?.(); };

      signal.addEventListener("abort", wake);

      // Kick off the run. Its Promise resolves with the final
      // joined text, but we don't ship that back — every event has
      // already been forwarded over SSE.
      const runPromise = runOnce(sessionManager, {
        ...(body as RunOnceOptions),
        onEvent: (event) => {
          queue.push(event);
          wake();
        },
      });

      // Make sure rejection wakes the drainer so we can flush an
      // error event and close.
      const errBox: { err: Error | null } = { err: null };
      runPromise.catch((err) => {
        errBox.err = err instanceof Error ? err : new Error(String(err));
        wake();
      });

      try {
        let terminated = false;
        while (!signal.aborted && !terminated) {
          if (queue.length === 0 && !errBox.err) {
            await new Promise<void>((r) => { wakeUp = r; });
            continue;
          }
          while (queue.length > 0) {
            const ev = queue.shift()!;
            await stream.writeSSE({ data: JSON.stringify(ev) });
            if (ev.type === "complete" || ev.type === "error") {
              terminated = true;
              break;
            }
          }
          if (errBox.err && !terminated) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: "error",
                message: errBox.err.message,
                timestamp: Date.now(),
              }),
            });
            terminated = true;
          }
        }
      } finally {
        // Drain (without awaiting writes) so a downstream caller's
        // failure doesn't leak the run process. runOnce's own finally
        // block already kills + removes the temp session.
        await runPromise.catch(() => { /* error already shipped over SSE */ });
      }
    });
  });

  app.openapi(completionRoute, async (c) => {
    let body = c.req.valid("json");
    try {
      body = resolveLaunchConfig(body as any) as typeof body;
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 400);
    }
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
      const meta = withConfiguredAppId(body.meta, { includeWhenMissing: true });
      db.prepare(
        `INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`
      ).run(id, body.label ?? id, sessionType, meta ? JSON.stringify(meta) : null);
      return c.json({ status: "created", id, meta: meta ?? null }, 200);
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
