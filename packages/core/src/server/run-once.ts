/**
 * One-shot agent execution: create a temp session, spawn (via the runtime
 * pool when supported), wait for the first `complete`/`error` event, then
 * clean up. Shared by the WebSocket `agent.run-once` op and the HTTP
 * `/agent/run-once` route.
 */

import { getConfig } from "../config.js";
import { getProvider } from "../core/providers/index.js";
import { spawnWithPool } from "../core/providers/spawn-helper.js";
import type { SessionManager } from "./session-manager.js";

export interface RunOnceOptions {
  message: string;
  model?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  permissionMode?: string;
  cwd?: string;
  timeout?: number;
  provider?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /**
   * Reasoning effort 0..5. See {@link import("../core/providers/types.js").SpawnOptions.reasoningLevel}.
   */
  reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;
  /** Provider-specific options (e.g. `{ omlxBaseUrl: "http://..." }`). */
  providerOptions?: Record<string, unknown>;
}

export interface RunOnceResult {
  result: string;
  usage: Record<string, unknown> | null;
}

export async function runOnce(
  sessionManager: SessionManager,
  opts: RunOnceOptions,
): Promise<RunOnceResult> {
  const sessionId = `run-once-${crypto.randomUUID().slice(0, 8)}`;
  const timeout = opts.timeout ?? getConfig().runOnceTimeoutMs;

  const session = sessionManager.createSession({
    id: sessionId,
    label: "run-once",
    cwd: opts.cwd ?? process.cwd(),
  });

  const cfg = getConfig();
  const provider = getProvider(opts.provider ?? cfg.defaultProvider);

  const extraArgs: string[] = opts.extraArgs ? [...opts.extraArgs] : [];
  if (opts.systemPrompt) extraArgs.push("--system-prompt", opts.systemPrompt);
  if (opts.appendSystemPrompt) extraArgs.push("--append-system-prompt", opts.appendSystemPrompt);

  // NOTE: deliberately not passing `configDir`. `RunOnceOptions` has no
  // separate config-dir argument, and forwarding `opts.cwd` here would
  // point CODEX_HOME / CLAUDE_CONFIG_DIR at the working tree — which
  // has no auth.json — and break pooled-daemon init for Codex.
  const proc = await spawnWithPool(provider, {
    cwd: session.cwd,
    prompt: opts.message,
    model: opts.model ?? cfg.model,
    permissionMode: (opts.permissionMode as any) ?? cfg.defaultPermissionMode,
    env: { ...opts.env, SNA_SESSION_ID: sessionId },
    extraArgs,
    providerOptions: opts.providerOptions,
    systemPrompt: opts.systemPrompt,
    appendSystemPrompt: opts.appendSystemPrompt,
    reasoningLevel: opts.reasoningLevel,
  });

  sessionManager.setProcess(sessionId, proc);

  try {
    const result = await new Promise<RunOnceResult>((resolve, reject) => {
      const texts: string[] = [];
      let usage: Record<string, unknown> | null = null;

      const timer = setTimeout(() => {
        reject(new Error(`run-once timed out after ${timeout}ms`));
      }, timeout);

      const unsub = sessionManager.onSessionEvent(sessionId, (_cursor, e) => {
        if (e.type === "assistant" && e.message) {
          texts.push(e.message);
        }
        if (e.type === "complete") {
          clearTimeout(timer);
          unsub();
          usage = (e.data as Record<string, unknown>) ?? null;
          resolve({ result: texts.join("\n"), usage });
        }
        if (e.type === "error") {
          clearTimeout(timer);
          unsub();
          reject(new Error(e.message ?? "Agent error"));
        }
      });
    });

    return result;
  } finally {
    sessionManager.killSession(sessionId);
    sessionManager.removeSession(sessionId);
  }
}
