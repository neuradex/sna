import http from 'http';
import http$1 from 'node:http';

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
 * Mock OpenAI-compatible API server for deterministic runtime tests.
 *
 * Implements:
 *   - GET  /v1/models
 *   - POST /v1/chat/completions
 *   - POST /v1/responses
 *
 * The default response reverses the last user text, matching the Anthropic
 * mock's deterministic behavior. Tests can provide a fixed string or callback
 * via `responseText` when they need exact output.
 */

interface MockOpenAIModel {
    id: string;
    object?: "model";
    created?: number;
    owned_by?: string;
    [key: string]: unknown;
}
type MockOpenAIEndpoint = "models" | "chat.completions" | "responses" | "unknown";
interface MockOpenAIRequest {
    timestamp: string;
    endpoint: MockOpenAIEndpoint;
    method: string;
    url: string;
    authorization?: string;
    model?: string;
    stream?: boolean;
    userText?: string;
    systemPromptLength?: number;
    requestBody?: any;
}
interface MockOpenAILogEntry extends MockOpenAIRequest {
    type: "request" | "response" | "error" | "info";
    replyText?: string;
    error?: string;
    message?: string;
}
interface MockOpenAIResponseContext {
    endpoint: "chat.completions" | "responses";
    requestBody: any;
    model: string;
    stream: boolean;
    userText: string;
    systemPrompt: string;
}
interface MockOpenAIOptions {
    models?: MockOpenAIModel[];
    responseText?: string | ((ctx: MockOpenAIResponseContext) => string);
    chunkSize?: number;
}
interface MockOpenAIServer {
    url: string;
    port: number;
    server: http$1.Server;
    requests: MockOpenAIRequest[];
    close: () => Promise<void>;
    /** Set a JSONL log writer. Each call receives one JSON line string. */
    onLog: (handler: (line: string) => void) => void;
}
declare function startMockOpenAIServer(options?: MockOpenAIOptions): Promise<MockOpenAIServer>;

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
    command: string;
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

export { type InstanceMeta, type MockLogEntry, type MockOpenAIEndpoint, type MockOpenAILogEntry, type MockOpenAIModel, type MockOpenAIOptions, type MockOpenAIRequest, type MockOpenAIResponseContext, type MockOpenAIServer, type MockServer, generateInstanceName, getInstanceDir, getInstancesDir, listInstances, readInstanceMeta, removeInstance, runOneshot, startMockAnthropicServer, startMockOpenAIServer, writeInstanceMeta };
