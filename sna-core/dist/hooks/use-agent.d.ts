interface AgentEvent {
    type: string;
    message?: string;
    data?: Record<string, unknown>;
    timestamp: number;
}
interface UseAgentOptions {
    /** Override base URL for agent API. Defaults to SnaContext apiUrl + "/agent" */
    baseUrl?: string;
    /** Provider name. Defaults to "claude-code" */
    provider?: string;
    /** Permission mode for the agent */
    permissionMode?: string;
    onEvent?: (e: AgentEvent) => void;
    onAssistant?: (e: AgentEvent) => void;
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
};

export { type AgentEvent, useAgent };
