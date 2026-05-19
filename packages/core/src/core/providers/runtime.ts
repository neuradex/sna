/**
 * Runtime abstraction — global lifecycle management for agent runtimes.
 *
 * Some providers (Codex, OpenCode) use a daemon-style runtime:
 *   - A single long-lived process (app-server / serve) handles multiple sessions.
 *   - Sessions are lightweight threads or HTTP sessions on top of the daemon.
 *
 * Other providers (Claude Code) are stateless per-session:
 *   - Each session spawns its own process.
 *   - No global daemon needed.
 *
 * This module defines the interfaces for both patterns so that
 * SessionManager can uniformly call prepareRuntime() before spawn().
 */

import type { ChildProcess } from "child_process";
import { logger } from "../../lib/logger.js";

// ── RuntimeHandle ──────────────────────────────────────────────────────

/**
 * Global runtime handle — shared across sessions that use the same
 * runtime configuration (daemon processes, app-server pools, etc.).
 */
export interface RuntimeHandle {
  /** Provider name for identification */
  provider: string;
  /** Whether the runtime is ready to accept sessions */
  ready: boolean;
  /** Optional daemon process (null for stateless providers like Claude Code) */
  readonly daemon?: ChildProcess;
  /** Count of active threads on the daemon (0 = no active sessions) */
  activeThreadCount: number;
  /**
   * HTTP base URL of the runtime daemon, when it speaks HTTP rather than
   * stdio JSON-RPC (e.g. OpenCode's `opencode serve`). Codex/Claude Code
   * leave this undefined.
   */
  readonly httpUrl?: string;
  /**
   * Optional shared secret for the runtime daemon. Currently unused — kept
   * here so that providers can add basic auth without breaking the
   * RuntimeHandle contract later.
   */
  readonly password?: string;
  /** Cleanup resources when SNA shuts down */
  dispose(): void;
}

/**
 * Runtime prepare function — called once per unique runtime config.
 * Returns a handle that can be shared across sessions.
 */
export type RuntimePrepareFn = (
  config: RuntimeConfig,
) => Promise<RuntimeHandle>;

/**
 * Configuration that determines runtime pool keying.
 * Sessions with the same config share a runtime handle.
 */
export interface RuntimeConfig {
  /** Working directory */
  cwd: string;
  /** Config home directory */
  configDir?: string;
  /** Model override */
  model?: string;
  /** Model provider (anthropic, openai, etc.) — used for keying pooled runtimes */
  modelProvider?: string;
  /** MCP server config hash */
  mcpConfigHash?: string;
  /** Hook/settings hash */
  settingsHash?: string;
  /** Permission mode */
  permissionMode?: string;
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
  /** MCP server config (raw, for providers that need it) */
  mcp?: Record<string, unknown>;
  /** Tool allow/disallow settings */
  settings?: { allowedTools?: string[]; disallowedTools?: string[] };
  /** Environment variables */
  env?: Record<string, string>;
}

// ── RuntimePool ────────────────────────────────────────────────────────

/**
 * Runtime pool — manages global runtime lifecycle.
 * Keyed by a hash of RuntimeConfig fields.
 *
 * Usage:
 *   const pool = new RuntimePool();
 *   const handle = await pool.prepare({ provider: "codex", cwd: "/project" });
 *   const proc = codexProvider.spawn(options, handle);
 *   // ... later ...
 *   pool.dispose();
 */
export class RuntimePool {
  private handles = new Map<string, RuntimeHandle>();

  /**
   * Prepare (or reuse) a runtime handle for the given config.
   * The key is a hash of the config fields that affect the global runtime.
   */
  async prepare(
    config: RuntimeConfig,
    provider: { prepareRuntime?: RuntimePrepareFn; name: string; supportsCwdPerThread?: boolean },
  ): Promise<RuntimeHandle> {
    const key = this.computeKey(config, provider.name, provider.supportsCwdPerThread);

    // Reuse existing handle if available
    const existing = this.handles.get(key);
    if (existing) {
      logger.log("runtime", `runtime pool hit: ${provider.name} key=${key}`);
      return existing;
    }

    // Prepare new runtime
    if (!provider.prepareRuntime) {
      // Stateless provider — return a no-op handle
      const handle: RuntimeHandle = {
        provider: provider.name,
        ready: true,
        activeThreadCount: 0,
        dispose: () => {},
      };
      this.handles.set(key, handle);
      logger.log("runtime", `runtime pool miss (stateless): ${provider.name}`);
      return handle;
    }

    const handle = await provider.prepareRuntime(config);
    handle.provider = provider.name;
    if (!handle.activeThreadCount) {
      handle.activeThreadCount = 0;
    }
    this.handles.set(key, handle);
    logger.log("runtime", `runtime pool miss (new): ${provider.name} key=${key} daemon=${!!handle.daemon}`);
    return handle;
  }

  /**
   * Loose, non-mutating lookup for stateless one-shot reuse. Returns any
   * pool handle that matches `provider` and is compatible with `cwd`,
   * ignoring full pool-key fields (MCP / hooks / permissions). Use this
   * from `provider.complete()` to opportunistically reuse a warm daemon
   * without taking on the responsibility of provisioning one.
   *
   * For providers that report `supportsCwdPerThread = true` (Codex
   * app-server today), `cwd` doesn't restrict the match — the daemon can
   * host threads at any working directory, so any warm daemon for the
   * provider is fair game.
   *
   * For session spawning use `prepare()` (which uses the strict key).
   */
  findCompatible(
    provider: { name: string; supportsCwdPerThread?: boolean },
    cwd: string,
  ): RuntimeHandle | null {
    for (const [key, handle] of this.handles) {
      if (!handle.ready) continue;
      if (provider.supportsCwdPerThread) {
        // Daemon is cwd-agnostic — match the provider name alone.
        if (key === provider.name || key.startsWith(`${provider.name}|`)) {
          return handle;
        }
      } else {
        // Match provider+cwd, ignore other key components.
        const exact = `${provider.name}|${cwd}`;
        const prefix = `${provider.name}|${cwd}|`;
        if (key === exact || key.startsWith(prefix)) {
          return handle;
        }
      }
    }
    return null;
  }

  /** Dispose all managed runtimes. */
  dispose(): void {
    for (const [key, handle] of this.handles) {
      try {
        // For pooled daemons: close all active threads first,
        // then kill the daemon process.
        if (handle.daemon && handle.activeThreadCount > 0) {
          logger.log("runtime", `disposing pooled runtime ${key}: closing ${handle.activeThreadCount} thread(s)`);
          handle.activeThreadCount = 0;
        }
        handle.dispose();
      } catch (err) {
        logger.err("runtime", `error disposing runtime ${key}: ${err}`);
      }
    }
    this.handles.clear();
    logger.log("runtime", "runtime pool disposed");
  }

  /** Get the number of managed runtimes. */
  get size(): number {
    return this.handles.size;
  }

  // ── Key computation ───────────────────────────────────────────────

  /**
   * Compute a pool key from RuntimeConfig.
   * Only fields that affect the global runtime are included.
   *
   * For pooled providers (Codex, OpenCode), additional fields are included
   * to ensure that different configurations get separate daemons:
   *   - profile: sandbox/permission profile (e.g. "danger-full-access")
   *   - hooksHash: hash of hooks.json content (tool filters, permission hooks)
   *   - configHash: hash of config.toml content (MCP servers, feature flags)
   *
   * When `supportsCwdPerThread` is true, `cwd` is dropped from the key — the
   * daemon can host threads operating on any cwd (each thread passes its own
   * via the provider's thread/turn params), so cross-cwd sessions share one
   * daemon instead of spawning a new one per workspace.
   */
  private computeKey(config: RuntimeConfig, providerName: string, supportsCwdPerThread = false): string {
    const parts: string[] = supportsCwdPerThread
      ? [providerName]
      : [providerName, config.cwd];

    if (config.configDir) parts.push(`configDir=${config.configDir}`);
    if (config.model) parts.push(`model=${config.model}`);
    // Prefer an explicit hash; otherwise derive one from `mcp` so daemons
    // with different MCP server sets (e.g. OpenCode pooled runtimes) are
    // not silently shared.
    let mcpHash = config.mcpConfigHash;
    if (!mcpHash && config.mcp && Object.keys(config.mcp).length > 0) {
      // Top-level key sort gives a stable string under arbitrary insertion
      // order. Inner objects are stringified normally — any nested change
      // (env, args, headers) flips the hash.
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(config.mcp).sort()) sorted[k] = config.mcp[k];
      mcpHash = JSON.stringify(sorted);
    }
    if (mcpHash) parts.push(`mcp=${mcpHash}`);
    if (config.settingsHash) parts.push(`settings=${config.settingsHash}`);
    if (config.permissionMode) parts.push(`perm=${config.permissionMode}`);

    // Codex-specific: different sandbox profiles need separate daemons
    // because the app-server binds the profile at init time.
    if (config.providerOptions?.profile) {
      parts.push(`profile=${config.providerOptions.profile}`);
    }

    // Codex-specific: different hooks config needs separate daemons
    // because hooks.json is per-CODEX_HOME and can't be hot-swapped.
    if (config.providerOptions?.hooksHash) {
      parts.push(`hooksHash=${config.providerOptions.hooksHash}`);
    }

    // Codex-specific: different config.toml (MCP servers, features)
    // needs separate daemons because it's per-CODEX_HOME.
    if (config.providerOptions?.configHash) {
      parts.push(`configHash=${config.providerOptions.configHash}`);
    }

    // OpenCode-specific: caller-provided external server URL routes all
    // sessions to that pre-existing daemon (skips internal spawn).
    if (config.providerOptions?.serverUrl) {
      parts.push(`serverUrl=${config.providerOptions.serverUrl}`);
    }

    // OpenCode-specific: hash of opencode.json overrides (model defaults,
    // MCP, permissions). Different overrides need different daemons because
    // OpenCode binds the config at startup via OPENCODE_CONFIG_CONTENT.
    if (config.providerOptions?.opencodeConfigHash) {
      parts.push(`opencodeCfg=${config.providerOptions.opencodeConfigHash}`);
    }

    return parts.join("|");
  }
}

// ── Global singleton ────────────────────────────────────────────────────

let _runtimePool: RuntimePool | null = null;

/**
 * Get or create the global RuntimePool singleton.
 *
 * Lives here rather than in `providers/index.ts` so individual provider
 * modules can reuse the pool without importing the provider registry —
 * which would otherwise create a circular dependency (index.ts
 * instantiates each provider class at module load).
 */
export function getRuntimePool(): RuntimePool {
  if (!_runtimePool) {
    _runtimePool = new RuntimePool();
  }
  return _runtimePool;
}
