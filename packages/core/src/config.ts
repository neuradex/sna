/**
 * config.ts — SNA SDK centralized configuration.
 *
 * All configurable values live here. No other file reads process.env.SNA_*
 * or hardcodes policy defaults. Priority (later wins):
 *
 *   1. Hardcoded defaults (this file)
 *   2. Environment variables (process.env.SNA_*)
 *   3. App-level overrides (setConfig)
 *   4. Per-call parameter overrides (function args)
 */

import path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SnaConfig {
  /** Application owner ID for this SNA server instance. env: SNA_APP_ID */
  appId?: string;

  /** SNA API server port. env: SNA_PORT */
  port: number;

  /** SNA API bind host. env: SNA_HOST */
  host: string;

  /** Bearer token required for protected HTTP and WebSocket routes. env: SNA_AUTH_TOKEN */
  authToken?: string;

  /** Browser origins allowed to call the SNA API. env: SNA_ALLOWED_ORIGINS */
  allowedOrigins: string[];

  /** Default LLM model. env: SNA_MODEL */
  model: string;

  /** Default agent provider. */
  defaultProvider: string;

  /** Default permission mode for agent operations. env: SNA_PERMISSION_MODE */
  defaultPermissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan";

  /** Max concurrent sessions. env: SNA_MAX_SESSIONS */
  maxSessions: number;

  /** Max events buffered in memory per session. */
  maxEventBuffer: number;

  /**
   * Permission request timeout (ms). 0 = no timeout (app controls).
   * When > 0, auto-denies after this duration.
   */
  permissionTimeoutMs: number;

  /** Run-once execution timeout (ms). */
  runOnceTimeoutMs: number;

  /** Skill event SSE poll interval (ms). */
  pollIntervalMs: number;

  /** SSE keepalive interval (ms). */
  keepaliveIntervalMs: number;

  /** WebSocket skill event poll interval (ms). */
  skillPollMs: number;

  /** SQLite database path. env: SNA_DB_PATH */
  dbPath: string;

  /** Base data directory for images, etc. env: SNA_DATA_DIR */
  dataDir: string;

  /**
   * Optional Langfuse tracing config.
   * When present, sessions with `meta.langfuseTrace: true` are traced.
   * When absent, tracing is fully disabled (zero overhead).
   */
  langfuse?: {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
  };

  /**
   * API proxy port for system prompt capture.
   * Set automatically by langfuse-tracer when debug mode is active.
   * When set, claude-code provider injects ANTHROPIC_BASE_URL into agent env.
   */
  apiProxyPort?: number;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const defaults: SnaConfig = {
  port: 3099,
  host: "127.0.0.1",
  allowedOrigins: [],
  model: "claude-sonnet-4-6",
  defaultProvider: "claude-code",
  defaultPermissionMode: "default",
  maxSessions: 5,
  maxEventBuffer: 500,
  permissionTimeoutMs: 0, // app controls — no SDK-side timeout
  runOnceTimeoutMs: 120_000,
  pollIntervalMs: 500,
  keepaliveIntervalMs: 15_000,
  skillPollMs: 2_000,
  dbPath: "data/sna.db",
  dataDir: path.join(process.cwd(), "data"),
};

// ── Environment overrides ────────────────────────────────────────────────────

function fromEnv(): Partial<SnaConfig> {
  const env: Partial<SnaConfig> = {};
  if (process.env.SNA_APP_ID) env.appId = process.env.SNA_APP_ID;
  if (process.env.SNA_PORT) env.port = parseInt(process.env.SNA_PORT, 10);
  if (process.env.SNA_HOST) env.host = process.env.SNA_HOST;
  if (process.env.SNA_AUTH_TOKEN) env.authToken = process.env.SNA_AUTH_TOKEN;
  if (process.env.SNA_ALLOWED_ORIGINS) {
    env.allowedOrigins = process.env.SNA_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  }
  if (process.env.SNA_MODEL) env.model = process.env.SNA_MODEL;
  if (process.env.SNA_PERMISSION_MODE) env.defaultPermissionMode = process.env.SNA_PERMISSION_MODE as SnaConfig["defaultPermissionMode"];
  if (process.env.SNA_MAX_SESSIONS) env.maxSessions = parseInt(process.env.SNA_MAX_SESSIONS, 10);
  if (process.env.SNA_DB_PATH) env.dbPath = process.env.SNA_DB_PATH;
  if (process.env.SNA_DATA_DIR) env.dataDir = process.env.SNA_DATA_DIR;
  if (process.env.SNA_PERMISSION_TIMEOUT_MS) env.permissionTimeoutMs = parseInt(process.env.SNA_PERMISSION_TIMEOUT_MS, 10);
  return env;
}

// ── State ────────────────────────────────────────────────────────────────────

let current: SnaConfig = { ...defaults, ...fromEnv() };

// ── API ──────────────────────────────────────────────────────────────────────

/** Get current config. Returns a frozen copy. */
export function getConfig(): Readonly<SnaConfig> {
  return current;
}

/** Override config values. Merges with existing (later wins). */
export function setConfig(overrides: Partial<SnaConfig>): void {
  current = { ...current, ...overrides };
}

/** Reset to defaults + env. Useful for testing. */
export function resetConfig(): void {
  current = { ...defaults, ...fromEnv() };
}

/** Return metadata tagged with the configured app owner, when one exists. */
export function withConfiguredAppId(
  meta: Record<string, unknown> | null | undefined,
  options: { includeWhenMissing?: boolean } = {},
): Record<string, unknown> | null | undefined {
  const appId = current.appId?.trim();
  if (!appId) return meta;
  if (meta === undefined && !options.includeWhenMissing) return undefined;

  const base = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  return { ...base, appId };
}

/** Metadata for newly created sessions owned by the configured app. */
export function configuredAppMeta(): Record<string, unknown> | undefined {
  return withConfiguredAppId(undefined, { includeWhenMissing: true }) as Record<string, unknown> | undefined;
}
