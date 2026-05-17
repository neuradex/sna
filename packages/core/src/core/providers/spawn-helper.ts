/**
 * spawn-helper.ts — the single point that fuses RuntimePool + provider.spawn.
 *
 * Background: every consumer that spawns an agent used to repeat the same
 * branch — "if the provider supports pooling, prepare a runtime handle and
 * pass it to spawn; otherwise spawn directly". The pattern lived inline in
 * routes/agent.ts, routes/openapi.ts, ws.ts, and several per-flow callsites
 * (start, resume, restart, run-once, patch-respawn). Whenever the pool
 * config grew a new field or a new spawn site was added, somebody had to
 * remember to update N copies — and at least one (#21's openapi.ts /start)
 * silently regressed because the duplicate diverged.
 *
 * Funneling everything through `spawnWithPool` eliminates that class of bug:
 * adding a new spawn site or a new pool key field only touches this file.
 */
import type { AgentProvider, AgentProcess, SpawnOptions } from "./types.js";
import type { RuntimeHandle, RuntimeConfig } from "./runtime.js";
import { getRuntimePool } from "./index.js";

/**
 * Spawn an agent, transparently going through the runtime pool when the
 * provider supports it. For non-pooled providers (claude-code today), the
 * function still works — it just calls `provider.spawn` directly.
 *
 * The pool prepare config is derived from `SpawnOptions` so callers don't
 * have to construct it separately and stay in sync with the spawn payload.
 * If a caller has a reason to override one of the pool fields (e.g. a hash
 * the runtime expects in `providerOptions`), pass it through `poolOverrides`
 * — those win on top of the derived values.
 */
export async function spawnWithPool(
  provider: AgentProvider,
  options: SpawnOptions,
  poolOverrides: Partial<RuntimeConfig> = {},
): Promise<AgentProcess> {
  let handle: RuntimeHandle | undefined;
  if (provider.supportsRuntimePooling) {
    const derived: RuntimeConfig = {
      cwd: options.cwd,
      configDir: options.configDir,
      model: options.model,
      permissionMode: options.permissionMode,
      providerOptions: options.providerOptions,
      mcp: options.mcpServers as Record<string, unknown> | undefined,
      settings: {
        allowedTools: options.allowedTools ?? [],
        disallowedTools: options.disallowedTools ?? [],
      },
      env: options.env,
    };
    handle = await getRuntimePool().prepare({ ...derived, ...poolOverrides }, provider);
  }
  return provider.spawn(options, handle);
}
