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
        userText?: string;
        systemPromptLength?: number;
        requestBody?: any;
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

interface ClaudeMockEnvOptions {
    /** Project cwd that Claude should trust. Defaults to process.cwd(). */
    cwd?: string;
    /** Anthropic-compatible mock URL, for example http://127.0.0.1:12345. */
    anthropicBaseUrl: string;
    /** Fake API key approved in the isolated Claude config. */
    apiKey?: string;
    /** Claude config directory. Defaults to <cwd>/.sna/mock-claude. */
    configDir?: string;
    /** Base env. Defaults to process.env. */
    env?: Record<string, string | undefined>;
    /** Extra env appended after mock-specific values. */
    extraEnv?: Record<string, string | undefined>;
    /** When false, only a small shell env allowlist is inherited. */
    inheritEnv?: boolean;
    /** Extra project paths to mark trusted in .claude.json. */
    trustedProjectPaths?: string[];
    /** Rewrite .claude.json even if it already exists. */
    overwrite?: boolean;
}
interface ClaudeMockEnv {
    env: Record<string, string>;
    cwd: string;
    configDir: string;
    configFile: string;
    apiKey: string;
    anthropicBaseUrl: string;
}
declare function createClaudeMockEnv(options: ClaudeMockEnvOptions): ClaudeMockEnv;

interface CodexMockEnvOptions {
    /** Project cwd to mark trusted in the isolated Codex config. Defaults to process.cwd(). */
    cwd?: string;
    /** OpenAI-compatible mock base URL, for example http://127.0.0.1:12345. */
    openAIBaseUrl: string;
    /** Fake API key exposed through OPENAI_API_KEY. */
    apiKey?: string;
    /** Codex home directory. Defaults to <cwd>/.sna/mock-codex. */
    codexHome?: string;
    /** Provider ID written into model_provider and [model_providers.<id>]. */
    providerId?: string;
    /** Default model written into config.toml. */
    model?: string;
    /** Base env. Defaults to process.env. */
    env?: Record<string, string | undefined>;
    /** Extra env appended after mock-specific values. */
    extraEnv?: Record<string, string | undefined>;
    /** When false, only a small shell env allowlist is inherited. */
    inheritEnv?: boolean;
    /** Extra project paths to mark trusted in config.toml. */
    trustedProjectPaths?: string[];
    /** Rewrite config.toml even if it already exists. */
    overwrite?: boolean;
}
interface CodexMockEnv {
    env: Record<string, string>;
    cwd: string;
    codexHome: string;
    configFile: string;
    apiKey: string;
    openAIBaseUrl: string;
    providerId: string;
    model: string;
}
declare function createCodexMockEnv(options: CodexMockEnvOptions): CodexMockEnv;

interface OpenCodeMockConfigOptions {
    /** OpenAI-compatible mock base URL, for example http://127.0.0.1:12345. */
    openAIBaseUrl: string;
    /** Fake API key passed to OpenCode's provider config. */
    apiKey?: string;
    /** OpenCode provider id. Defaults to "sna-mock". */
    providerId?: string;
    /** OpenCode model id under the provider. Defaults to "sna-model". */
    modelId?: string;
    /** Human readable model name shown by OpenCode. */
    modelName?: string;
    /** Agent name to pass through providerOptions.agent. Defaults to "build". */
    agent?: string;
    /** Maximum OpenCode agent loop steps for the generated agent config. */
    maxSteps?: number;
    /** Model context window advertised to OpenCode. */
    contextWindow?: number;
    /** Model output limit advertised to OpenCode. */
    outputLimit?: number;
    /** Merge extra top-level OpenCode config fields after the mock provider config. */
    extraConfig?: Record<string, unknown>;
}
interface OpenCodeMockConfig {
    config: Record<string, unknown>;
    providerOptions: Record<string, unknown>;
    model: string;
    providerId: string;
    modelId: string;
    apiKey: string;
    openAIBaseUrl: string;
}
declare function createOpenCodeMockConfig(options: OpenCodeMockConfigOptions): OpenCodeMockConfig;

interface GrokMockEnvOptions {
    /** Project cwd for the Grok session. Defaults to process.cwd(). */
    cwd?: string;
    /** OpenAI-compatible mock base URL, for example http://127.0.0.1:12345. */
    openAIBaseUrl: string;
    /** Fake API key exposed through XAI_API_KEY. */
    apiKey?: string;
    /** Isolated HOME for Grok config/auth. Defaults to <cwd>/.sna/mock-grok-home. */
    grokHome?: string;
    /** Model passed to the Grok provider. */
    model?: string;
    /** Base env. Defaults to process.env. */
    env?: Record<string, string | undefined>;
    /** Extra env appended after mock-specific values. */
    extraEnv?: Record<string, string | undefined>;
    /** When false, only a small shell env allowlist is inherited. */
    inheritEnv?: boolean;
    /** Rewrite config.toml even if it already exists. */
    overwrite?: boolean;
}
interface GrokMockEnv {
    env: Record<string, string>;
    cwd: string;
    grokHome: string;
    configDir: string;
    configFile: string;
    apiKey: string;
    openAIBaseUrl: string;
    xaiApiBaseUrl: string;
    model: string;
    providerOptions: Record<string, unknown>;
}
declare function createGrokMockEnv(options: GrokMockEnvOptions): GrokMockEnv;

interface MockCliInvocation {
    argv: string[];
    cwd: string;
    env: Record<string, string | undefined>;
    timestamp: string;
}
interface MockRuntimeCli {
    command: string;
    dir: string;
    invocationsFile: string;
    readInvocations(): MockCliInvocation[];
    close(): void;
}
interface MockCodexExecCliOptions {
    apiKey?: string;
}
interface MockClaudeCliOptions {
    apiKey?: string;
    defaultModel?: string;
}
declare function createMockCodexExecCli(input: string | MockOpenAIServer, options?: MockCodexExecCliOptions): MockRuntimeCli;
declare function createMockClaudeCli(input: string | MockServer, options?: MockClaudeCliOptions): MockRuntimeCli;

interface WaitForRequestOptions {
    timeoutMs?: number;
    intervalMs?: number;
}
declare function readSseData(res: Response): Promise<string[]>;
declare function waitForRequest<TRequest>(source: {
    requests: TRequest[];
}, predicate?: (request: TRequest) => boolean, options?: WaitForRequestOptions): Promise<TRequest>;
declare function withMockAnthropicServer<T>(fn: (mock: MockServer) => Promise<T> | T): Promise<T>;
declare function withMockOpenAIServer<T>(options: MockOpenAIOptions, fn: (mock: MockOpenAIServer) => Promise<T> | T): Promise<T>;
declare function withMockOpenAIServer<T>(fn: (mock: MockOpenAIServer) => Promise<T> | T): Promise<T>;

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

export { type ClaudeMockEnv, type ClaudeMockEnvOptions, type CodexMockEnv, type CodexMockEnvOptions, type GrokMockEnv, type GrokMockEnvOptions, type InstanceMeta, type MockClaudeCliOptions, type MockCliInvocation, type MockCodexExecCliOptions, type MockLogEntry, type MockOpenAIEndpoint, type MockOpenAILogEntry, type MockOpenAIModel, type MockOpenAIOptions, type MockOpenAIRequest, type MockOpenAIResponseContext, type MockOpenAIServer, type MockRuntimeCli, type MockServer, type OpenCodeMockConfig, type OpenCodeMockConfigOptions, type WaitForRequestOptions, createClaudeMockEnv, createCodexMockEnv, createGrokMockEnv, createMockClaudeCli, createMockCodexExecCli, createOpenCodeMockConfig, generateInstanceName, getInstanceDir, getInstancesDir, listInstances, readInstanceMeta, readSseData, removeInstance, runOneshot, startMockAnthropicServer, startMockOpenAIServer, waitForRequest, withMockAnthropicServer, withMockOpenAIServer, writeInstanceMeta };
