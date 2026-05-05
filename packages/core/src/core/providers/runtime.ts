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
    provider: { prepareRuntime?: RuntimePrepareFn; name: string },
  ): Promise<RuntimeHandle> {
    const key = this.computeKey(config, provider.name);

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
   */
  private computeKey(config: RuntimeConfig, providerName: string): string {
    const parts: string[] = [providerName, config.cwd];

    if (config.configDir) parts.push(`configDir=${config.configDir}`);
    if (config.model) parts.push(`model=${config.model}`);
    if (config.mcpConfigHash) parts.push(`mcp=${config.mcpConfigHash}`);
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

    return parts.join("|");
  }
}
