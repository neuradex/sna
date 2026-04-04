import http from 'http';

/**
 * Mock Anthropic Messages API server for testing.
 *
 * Implements POST /v1/messages with streaming SSE responses.
 * Set ANTHROPIC_BASE_URL=http://localhost:<port> and
 * ANTHROPIC_API_KEY=any-string to redirect Claude Code here.
 *
 * All events are emitted as structured JSONL via the `onLog` callback,
 * enabling instance-scoped log capture by the CLI.
 */

interface MockServer {
    port: number;
    server: http.Server;
    close: () => void;
    requests: Array<{
        model: string;
        messages: any[];
        stream: boolean;
        timestamp: string;
    }>;
    /** Set a JSONL log writer. Each call receives one JSON line string (no trailing newline). */
    onLog: (handler: (line: string) => void) => void;
}
interface MockLogEntry {
    ts: string;
    type: "request" | "response" | "error" | "info";
    method?: string;
    url?: string;
    model?: string;
    stream?: boolean;
    messageCount?: number;
    userText?: string;
    systemPromptLength?: number;
    replyText?: string;
    requestBody?: any;
    error?: string;
    message?: string;
}
declare function startMockAnthropicServer(): Promise<MockServer>;

/**
 * sna tu claude:oneshot — auto mock API + run claude + dump all logs.
 *
 * Outputs:
 *   - Claude stdout/stderr
 *   - Mock API request body → .sna/mock-api-last-request.json
 *   - Mock API log → .sna/mock-api.log
 *   - Summary with file paths
 */
declare function runOneshot(cliArgs?: string[]): Promise<void>;

/**
 * Instance management — Docker-like named test instances.
 *
 * Each `sna-test claude` run creates an instance with a unique name
 * (adjective-noun pair). All logs for that run are stored under
 * `.sna/instances/<name>/`.
 */
declare function generateInstanceName(): string;
declare function getInstancesDir(): string;
declare function getInstanceDir(name: string): string;
interface InstanceMeta {
    name: string;
    mode: "oneshot" | "interactive";
    createdAt: string;
    pid?: number;
    mockPort?: number;
    exitCode?: number | null;
    status: "running" | "done" | "error";
}
declare function writeInstanceMeta(name: string, meta: InstanceMeta): void;
declare function readInstanceMeta(name: string): InstanceMeta | null;
declare function listInstances(): InstanceMeta[];
declare function removeInstance(name: string): boolean;

export { type InstanceMeta, type MockLogEntry, type MockServer, generateInstanceName, getInstanceDir, getInstancesDir, listInstances, readInstanceMeta, removeInstance, runOneshot, startMockAnthropicServer, writeInstanceMeta };
