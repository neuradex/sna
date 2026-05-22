import type { AuthRequest } from "./features/auth-requests";
import type { SnaSession } from "./features/sessions";

export interface HealthResponse {
  ok: boolean;
  name?: string;
  version?: string;
}

export interface AuthRequestsResponse {
  requests: AuthRequest[];
}

export interface SessionsResponse {
  sessions: SnaSession[];
}

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;
export type ReasoningLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface RuntimeLaunchConfig {
  provider?: string;
  modelProvider?: string;
  model?: string;
  cwd?: string;
  permissionMode?: string;
  configDir?: string;
  extraArgs?: string[];
  providerOptions?: Record<string, unknown>;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  env?: Record<string, string>;
  reasoningLevel?: ReasoningLevel;
}

export interface RegisteredRuntime {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  modelProvider?: string;
  defaultModel?: string;
  cliPath?: string;
  models?: Array<{ id: string; label?: string; provider?: string }>;
  config?: RuntimeLaunchConfig;
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeCatalogEntry {
  id: string;
  label: string;
  available: boolean;
  supportsRuntimePooling: boolean;
  supportsCwdPerThread: boolean;
  modelListing: boolean;
  detection: RuntimeDetectionInfo;
}

export interface RuntimeDetectionInfo {
  detected: boolean;
  path: string;
  version?: string;
  source: "env" | "cache" | "static" | "shell" | "fallback";
  message?: string;
}

export interface RuntimeProfile {
  level: DifficultyLevel;
  label: string;
  description: string;
  runtimeId?: string;
  modelPresetId?: string;
  config: RuntimeLaunchConfig;
  updatedAt?: number;
}

export interface ModelPreset {
  id: string;
  name: string;
  runtimeId: string;
  model?: string;
  modelProvider?: string;
  reasoningLevel: ReasoningLevel;
  createdAt: number;
  updatedAt: number;
}

export interface RuntimesResponse {
  runtimes: RegisteredRuntime[];
}

export interface RuntimeCatalogResponse {
  runtimes: RuntimeCatalogEntry[];
}

export interface ProfilesResponse {
  profiles: RuntimeProfile[];
}

export interface ModelPresetsResponse {
  presets: ModelPreset[];
}

export interface RuntimeModelInfo {
  id: string;
  label: string;
  provider: string;
  source: "static" | "api" | "cli";
  contextWindow?: number;
  deprecated?: boolean;
  notes?: string;
}

export interface ListModelsResponse {
  models: RuntimeModelInfo[];
  source: "static" | "api" | "cli" | "mixed";
  fetchedAt: number;
  error?: string;
}

export interface RuntimeAuditRuntime extends RegisteredRuntime {
  activeSessionCount: number;
  sessionCount: number;
}

export interface RuntimeAuditSession {
  id: string;
  label: string;
  state: string;
  alive: boolean;
  provider?: string;
  modelProvider?: string;
  model?: string;
  runtimeId?: string;
  modelPresetId?: string;
  profileLevel?: DifficultyLevel;
  reasoningLevel?: ReasoningLevel;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
}

export interface RuntimeAuditApp {
  clientId: string;
  displayName: string | null;
  scopes: string[];
  tokenCount: number;
  activeTokenCount: number;
  lastIssuedAt?: number;
}

export interface AgentAuditResponse {
  profiles: RuntimeProfile[];
  modelPresets: ModelPreset[];
  runtimes: RuntimeAuditRuntime[];
  sessions: RuntimeAuditSession[];
  apps: RuntimeAuditApp[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const hasBody = options.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    credentials: "same-origin",
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Empty responses are allowed for a few operational endpoints.
  }
  if (!res.ok) {
    const message = typeof body === "object" && body && "message" in body
      ? String((body as { message?: unknown }).message)
      : `${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}
