import type Database from "better-sqlite3";
import { getDb } from "../db/schema.js";
import type { SessionInfo } from "./session-manager.js";

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

export interface RuntimeProfile {
  level: DifficultyLevel;
  label: string;
  description: string;
  runtimeId?: string;
  modelPresetId?: string;
  config: RuntimeLaunchConfig;
  updatedAt?: number;
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

export interface ResolveLaunchInput extends RuntimeLaunchConfig {
  profileLevel?: DifficultyLevel;
  runtimeId?: string;
  modelPresetId?: string;
  [key: string]: unknown;
}

export interface ResolvedLaunchConfig extends ResolveLaunchInput {
  profileLevel?: DifficultyLevel;
  runtimeId?: string;
  modelPresetId?: string;
}

const RUNTIME_SETTINGS_KEY = "agent.runtimes.v1";
const PROFILE_SETTINGS_KEY = "agent.profiles.v1";
const MODEL_PRESET_SETTINGS_KEY = "agent.modelPresets.v1";

const DEFAULT_PROFILES: RuntimeProfile[] = [
  {
    level: 1,
    label: "Level 1",
    description: "Fast, low-risk tasks.",
    config: { reasoningLevel: 1 },
  },
  {
    level: 2,
    label: "Level 2",
    description: "Small implementation and routine analysis.",
    config: { reasoningLevel: 2 },
  },
  {
    level: 3,
    label: "Level 3",
    description: "Normal product work.",
    config: { reasoningLevel: 3 },
  },
  {
    level: 4,
    label: "Level 4",
    description: "Difficult changes that need deeper reasoning.",
    config: { reasoningLevel: 4 },
  },
  {
    level: 5,
    label: "Level 5",
    description: "Maximum effort for high-risk or ambiguous work.",
    config: { reasoningLevel: 5 },
  },
];

function readSetting<T>(db: Database.Database, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM sna_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function writeSetting<T>(db: Database.Database, key: string, value: T): void {
  db.prepare(`
    INSERT INTO sna_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), Date.now());
}

function assertValidId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) {
    throw new Error("id must be 1-64 chars and contain only letters, numbers, dot, underscore, or dash");
  }
}

function assertDifficultyLevel(level: number): asserts level is DifficultyLevel {
  if (![1, 2, 3, 4, 5].includes(level)) {
    throw new Error("profile level must be between 1 and 5");
  }
}

function mergeDefined<T extends Record<string, unknown>>(...parts: Array<T | undefined>): T {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out as T;
}

function listRegisteredRuntimesFromDb(db: Database.Database): RegisteredRuntime[] {
  return readSetting<RegisteredRuntime[]>(db, RUNTIME_SETTINGS_KEY, []);
}

export function listRegisteredRuntimes(): RegisteredRuntime[] {
  return listRegisteredRuntimesFromDb(getDb());
}

function getRegisteredRuntimeFromDb(id: string, db: Database.Database): RegisteredRuntime | undefined {
  return listRegisteredRuntimesFromDb(db).find((runtime) => runtime.id === id);
}

export function getRegisteredRuntime(id: string): RegisteredRuntime | undefined {
  return getRegisteredRuntimeFromDb(id, getDb());
}

export function upsertRegisteredRuntime(
  id: string,
  input: {
    provider: string;
    label?: string;
    enabled?: boolean;
    modelProvider?: string;
    defaultModel?: string;
    cliPath?: string;
    models?: Array<{ id: string; label?: string; provider?: string }>;
    config?: RuntimeLaunchConfig;
  },
): RegisteredRuntime {
  const db = getDb();
  assertValidId(id);
  const now = Date.now();
  const runtimes = listRegisteredRuntimesFromDb(db);
  const existing = runtimes.find((runtime) => runtime.id === id);
  const next: RegisteredRuntime = {
    id,
    provider: input.provider,
    label: input.label ?? existing?.label ?? id,
    enabled: input.enabled ?? existing?.enabled ?? true,
    modelProvider: input.modelProvider ?? existing?.modelProvider,
    defaultModel: input.defaultModel ?? existing?.defaultModel,
    cliPath: input.cliPath ?? existing?.cliPath,
    models: input.models ?? existing?.models,
    config: input.config ?? existing?.config,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const updated = existing
    ? runtimes.map((runtime) => runtime.id === id ? next : runtime)
    : [...runtimes, next];
  writeSetting(db, RUNTIME_SETTINGS_KEY, updated);
  return next;
}

function assertReasoningLevel(level: number): asserts level is ReasoningLevel {
  if (![0, 1, 2, 3, 4, 5].includes(level)) {
    throw new Error("reasoning level must be between 0 and 5");
  }
}

function listModelPresetsFromDb(db: Database.Database): ModelPreset[] {
  return readSetting<ModelPreset[]>(db, MODEL_PRESET_SETTINGS_KEY, []);
}

export function listModelPresets(): ModelPreset[] {
  return listModelPresetsFromDb(getDb());
}

function getModelPresetFromDb(id: string, db: Database.Database): ModelPreset | undefined {
  return listModelPresetsFromDb(db).find((preset) => preset.id === id);
}

export function upsertModelPreset(
  id: string,
  input: {
    name?: string;
    runtimeId: string;
    model?: string;
    modelProvider?: string;
    reasoningLevel: number;
  },
): ModelPreset {
  const db = getDb();
  assertValidId(id);
  assertValidId(input.runtimeId);
  assertReasoningLevel(input.reasoningLevel);
  const runtime = getRegisteredRuntimeFromDb(input.runtimeId, db);
  if (!runtime) throw new Error(`Registered runtime "${input.runtimeId}" not found`);
  const now = Date.now();
  const presets = listModelPresetsFromDb(db);
  const existing = presets.find((preset) => preset.id === id);
  const name = input.name?.trim() || existing?.name || id;
  const next: ModelPreset = {
    id,
    name,
    runtimeId: input.runtimeId,
    model: input.model?.trim() || undefined,
    modelProvider: input.modelProvider?.trim() || undefined,
    reasoningLevel: input.reasoningLevel,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const updated = existing
    ? presets.map((preset) => preset.id === id ? next : preset)
    : [...presets, next];
  writeSetting(db, MODEL_PRESET_SETTINGS_KEY, updated);
  return next;
}

function listRuntimeProfilesFromDb(db: Database.Database): RuntimeProfile[] {
  const stored = readSetting<RuntimeProfile[]>(db, PROFILE_SETTINGS_KEY, []);
  return DEFAULT_PROFILES.map((profile) => {
    const override = stored.find((candidate) => candidate.level === profile.level);
    if (!override) return profile;
    return {
      ...profile,
      ...override,
      config: mergeDefined(profile.config as Record<string, unknown>, override.config as Record<string, unknown>) as RuntimeLaunchConfig,
    };
  });
}

export function listRuntimeProfiles(): RuntimeProfile[] {
  return listRuntimeProfilesFromDb(getDb());
}

function getRuntimeProfileFromDb(level: DifficultyLevel, db: Database.Database): RuntimeProfile {
  return listRuntimeProfilesFromDb(db).find((profile) => profile.level === level)!;
}

export function getRuntimeProfile(level: DifficultyLevel): RuntimeProfile {
  return getRuntimeProfileFromDb(level, getDb());
}

export function upsertRuntimeProfile(
  level: number,
  input: {
    label?: string;
    description?: string;
    runtimeId?: string | null;
    modelPresetId?: string | null;
    config?: RuntimeLaunchConfig;
  },
): RuntimeProfile {
  const db = getDb();
  assertDifficultyLevel(level);
  if (input.runtimeId !== undefined && input.runtimeId !== null) assertValidId(input.runtimeId);
  if (input.modelPresetId !== undefined && input.modelPresetId !== null) {
    assertValidId(input.modelPresetId);
    if (!getModelPresetFromDb(input.modelPresetId, db)) {
      throw new Error(`Model preset "${input.modelPresetId}" not found`);
    }
  }
  const profiles = listRuntimeProfilesFromDb(db);
  const current = profiles.find((profile) => profile.level === level)!;
  const next: RuntimeProfile = {
    ...current,
    label: input.label ?? current.label,
    description: input.description ?? current.description,
    runtimeId: input.runtimeId === null ? undefined : input.runtimeId ?? current.runtimeId,
    modelPresetId: input.modelPresetId === null ? undefined : input.modelPresetId ?? current.modelPresetId,
    config: mergeDefined(current.config as Record<string, unknown>, input.config as Record<string, unknown>) as RuntimeLaunchConfig,
    updatedAt: Date.now(),
  };
  const stored = profiles.map((profile) => profile.level === level ? next : profile);
  writeSetting(db, PROFILE_SETTINGS_KEY, stored);
  return next;
}

function runtimeDefaults(runtime: RegisteredRuntime): RuntimeLaunchConfig & { runtimeId: string } {
  const merged = mergeDefined(
    {
      provider: runtime.provider,
      modelProvider: runtime.modelProvider,
      model: runtime.defaultModel,
    },
    runtime.config as Record<string, unknown> | undefined,
  ) as RuntimeLaunchConfig;
  return { ...merged, runtimeId: runtime.id };
}

export function resolveLaunchConfig<T extends ResolveLaunchInput>(input: T): T & ResolvedLaunchConfig {
  const db = getDb();
  const profileLevel = input.profileLevel;
  let profile: RuntimeProfile | undefined;
  if (profileLevel !== undefined) {
    assertDifficultyLevel(profileLevel);
    profile = getRuntimeProfileFromDb(profileLevel, db);
  }

  let modelPreset: ModelPreset | undefined;
  const modelPresetId = input.modelPresetId ?? profile?.modelPresetId;
  if (modelPresetId) {
    modelPreset = getModelPresetFromDb(modelPresetId, db);
    if (!modelPreset) throw new Error(`Model preset "${modelPresetId}" not found`);
  }

  const runtimeId = input.runtimeId ?? modelPreset?.runtimeId ?? profile?.runtimeId;
  let runtime: RegisteredRuntime | undefined;
  if (runtimeId) {
    runtime = getRegisteredRuntimeFromDb(runtimeId, db);
    if (!runtime) throw new Error(`Registered runtime "${runtimeId}" not found`);
    if (!runtime.enabled) throw new Error(`Registered runtime "${runtimeId}" is disabled`);
  }

  const profileConfig = profile ? { ...profile.config } : undefined;
  if (profileConfig && modelPreset) {
    delete profileConfig.model;
    delete profileConfig.modelProvider;
    delete profileConfig.reasoningLevel;
  }

  return mergeDefined(
    runtime ? runtimeDefaults(runtime) as unknown as Record<string, unknown> : undefined,
    profile ? { ...profileConfig, profileLevel: profile.level, runtimeId: runtimeId ?? profile.runtimeId } : undefined,
    modelPreset ? {
      model: modelPreset.model,
      modelProvider: modelPreset.modelProvider,
      reasoningLevel: modelPreset.reasoningLevel,
      runtimeId: modelPreset.runtimeId,
      modelPresetId: modelPreset.id,
    } : undefined,
    input,
  ) as T & ResolvedLaunchConfig;
}

function redactLaunchConfig(config: RuntimeLaunchConfig | undefined): RuntimeLaunchConfig | undefined {
  if (!config) return undefined;
  const { env, ...rest } = config;
  if (!env) return rest;
  return {
    ...rest,
    env: Object.fromEntries(Object.keys(env).map((key) => [key, "<redacted>"])),
  };
}

export function buildAgentAudit(
  sessions: SessionInfo[],
): {
  profiles: RuntimeProfile[];
  modelPresets: ModelPreset[];
  runtimes: Array<RegisteredRuntime & { config?: RuntimeLaunchConfig; activeSessionCount: number; sessionCount: number }>;
  sessions: SessionInfo[];
  apps: Array<{
    appId: string;
    displayName: string | null;
    scopes: string[];
    tokenCount: number;
    activeTokenCount: number;
    sessionCount: number;
    lastUsedAt: number | null;
  }>;
} {
  const db = getDb();
  const profiles = listRuntimeProfilesFromDb(db);
  const runtimes = listRegisteredRuntimesFromDb(db).map((runtime) => {
    const linkedSessions = sessions.filter((session) => session.config?.runtimeId === runtime.id);
    return {
      ...runtime,
      config: redactLaunchConfig(runtime.config),
      activeSessionCount: linkedSessions.filter((session) => session.alive).length,
      sessionCount: linkedSessions.length,
    };
  });

  const appMap = new Map<string, {
    appId: string;
    displayName: string | null;
    scopes: Set<string>;
    tokenCount: number;
    activeTokenCount: number;
    sessionCount: number;
    lastUsedAt: number | null;
  }>();

  for (const session of sessions) {
    const appId = typeof session.meta?.appId === "string" ? session.meta.appId : "unattributed";
    const existing = appMap.get(appId) ?? {
      appId,
      displayName: null,
      scopes: new Set<string>(),
      tokenCount: 0,
      activeTokenCount: 0,
      sessionCount: 0,
      lastUsedAt: null,
    };
    existing.sessionCount += 1;
    appMap.set(appId, existing);
  }

  const tokenRows = db.prepare(`
    SELECT client_id, display_name, scopes, last_used_at, revoked_at
      FROM auth_tokens
  `).all() as Array<{ client_id: string; display_name: string | null; scopes: string; last_used_at: number; revoked_at: number | null }>;
  for (const row of tokenRows) {
    const existing = appMap.get(row.client_id) ?? {
      appId: row.client_id,
      displayName: row.display_name,
      scopes: new Set<string>(),
      tokenCount: 0,
      activeTokenCount: 0,
      sessionCount: 0,
      lastUsedAt: null,
    };
    existing.displayName = row.display_name ?? existing.displayName;
    existing.tokenCount += 1;
    if (row.revoked_at === null) existing.activeTokenCount += 1;
    try {
      for (const scope of JSON.parse(row.scopes) as string[]) existing.scopes.add(scope);
    } catch {
      existing.scopes.add(row.scopes);
    }
    existing.lastUsedAt = Math.max(existing.lastUsedAt ?? 0, row.last_used_at);
    appMap.set(row.client_id, existing);
  }

  return {
    profiles,
    modelPresets: listModelPresetsFromDb(db),
    runtimes,
    sessions,
    apps: Array.from(appMap.values()).map((app) => ({
      ...app,
      scopes: Array.from(app.scopes).sort(),
    })),
  };
}
