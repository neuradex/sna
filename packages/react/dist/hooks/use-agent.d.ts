import { AgentEvent } from '@sna-sdk/core';
export { AgentEvent } from '@sna-sdk/core';

interface UseAgentOptions {
    /** Session ID. Defaults to "default". */
    sessionId?: string;
    /** Override base URL for agent API. Defaults to SnaContext apiUrl + "/agent" */
    baseUrl?: string;
    /** Override bearer token. Defaults to SnaContext authToken. */
    authToken?: string;
    /** Provider name. Defaults to "claude-code" */
    provider?: string;
    /** Permission mode for the agent */
    permissionMode?: string;
    /**
     * Reasoning effort 0..5 (lightest → heaviest), passed to `start()` and
     * `completion()` so the underlying provider sets `--effort` (Claude) or
     * `model_reasoning_effort` (Codex) accordingly. Omit to inherit the
     * provider's own default.
     */
    reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;
    /**
     * Provider-specific options passed through to the selected runtime.
     * Codex-only knobs include `serviceTier` ("priority" / "flex" / "batch" —
     * the `/fast` slash-command equivalent).
     */
    providerOptions?: Record<string, unknown>;
    onEvent?: (e: AgentEvent) => void;
    onThinking?: (e: AgentEvent) => void;
    onAssistant?: (e: AgentEvent) => void;
    onToolResult?: (e: AgentEvent) => void;
    onComplete?: (e: AgentEvent) => void;
    onError?: (e: AgentEvent) => void;
    onInit?: (e: AgentEvent) => void;
}
/**
 * useAgent — subscribe to an agent session's event stream and send messages.
 *
 * Always connects to the SSE stream on mount.
 * Use `send()` to send messages (spawns `claude -p --resume` per message).
 */
declare function useAgent(options?: UseAgentOptions): {
    connected: boolean;
    alive: boolean;
    start: (prompt?: string) => Promise<any>;
    send: (message: string) => Promise<any>;
    kill: () => Promise<void>;
    completion: (opts: {
        prompt: string;
        model?: string;
        systemPrompt?: string;
        /** Reasoning effort 0..5. Falls back to the hook-level reasoningLevel. */
        reasoningLevel?: 0 | 1 | 2 | 3 | 4 | 5;
        /** Provider-specific options. Codex: `serviceTier` for `/fast` lane. */
        providerOptions?: Record<string, unknown>;
    }) => Promise<any>;
};

export { useAgent };
