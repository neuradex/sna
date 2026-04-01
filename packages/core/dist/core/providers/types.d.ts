/**
 * Normalized event type emitted by all agent providers.
 *
 * Providers translate their native event format (Claude Code stream-json,
 * Codex JSONL, etc.) into these common types.
 */
interface AgentEvent {
    type: "init" | "thinking" | "text_delta" | "assistant" | "tool_use" | "tool_result" | "permission_needed" | "milestone" | "user_message" | "interrupted" | "error" | "complete";
    message?: string;
    data?: Record<string, unknown>;
    timestamp: number;
}
/**
 * A running agent process. Wraps a child_process with typed event handlers.
 */
interface AgentProcess {
    /** Send a user message to the agent's stdin. Accepts string or content blocks (text + images). */
    send(input: string | ContentBlock[]): void;
    /** Interrupt the current turn. Process stays alive. */
    interrupt(): void;
    /** Change model at runtime via control message. No restart needed. */
    setModel(model: string): void;
    /** Change permission mode at runtime via control message. No restart needed. */
    setPermissionMode(mode: string): void;
    /** Kill the agent process. */
    kill(): void;
    /** Whether the process is still running. */
    readonly alive: boolean;
    /** Session ID assigned by the provider. */
    readonly sessionId: string | null;
    on(event: "event", handler: (e: AgentEvent) => void): void;
    on(event: "exit", handler: (code: number | null) => void): void;
    on(event: "error", handler: (err: Error) => void): void;
    off(event: string, handler: Function): void;
}
/**
 * Options for spawning an agent session.
 */
type ContentBlock = {
    type: "text";
    text: string;
} | {
    type: "image";
    source: {
        type: "base64";
        media_type: string;
        data: string;
    };
};
interface HistoryMessage {
    role: "user" | "assistant";
    content: string;
}
interface SpawnOptions {
    cwd: string;
    prompt?: string;
    model?: string;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
    env?: Record<string, string>;
    /**
     * Conversation history to inject before the first prompt.
     * Written to stdin as NDJSON — Claude Code treats these as prior conversation turns.
     * Must alternate user→assistant. Assistant content is auto-wrapped in array format.
     */
    history?: HistoryMessage[];
    /** @internal Set by provider when history was injected via JSONL resume. */
    _historyViaResume?: boolean;
    /**
     * Additional CLI flags passed directly to the agent binary.
     * e.g. ["--system-prompt", "You are...", "--append-system-prompt", "Also...", "--mcp-config", "path"]
     */
    extraArgs?: string[];
}
/**
 * Agent provider interface. Each backend (Claude Code, Codex, etc.)
 * implements this to provide a unified spawn → events → send API.
 */
interface AgentProvider {
    readonly name: string;
    /** Check if this provider's CLI is available on the system. */
    isAvailable(): Promise<boolean>;
    /** Spawn a new agent session. */
    spawn(options: SpawnOptions): AgentProcess;
}

export type { AgentEvent, AgentProcess, AgentProvider, ContentBlock, HistoryMessage, SpawnOptions };
