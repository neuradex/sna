import http from 'http';

/**
 * Mock Anthropic Messages API server for testing.
 *
 * Implements POST /v1/messages with streaming SSE responses.
 * Set ANTHROPIC_BASE_URL=http://localhost:<port> and
 * ANTHROPIC_API_KEY=any-string to redirect Claude Code here.
 *
 * All requests and responses are logged to stdout (captured by sna tu api:up → .sna/mock-api.log).
 *
 * Usage:
 *   import { startMockAnthropicServer } from "@sna-sdk/core/testing";
 *   const mock = await startMockAnthropicServer();
 *   process.env.ANTHROPIC_BASE_URL = `http://localhost:${mock.port}`;
 *   process.env.ANTHROPIC_API_KEY = "test-key";
 *   // ... spawn claude code, run tests ...
 *   mock.close();
 */

interface MockServer {
    port: number;
    server: http.Server;
    close: () => void;
    /** Messages received by the mock server */
    requests: Array<{
        model: string;
        messages: any[];
        stream: boolean;
        timestamp: string;
    }>;
}
declare function startMockAnthropicServer(): Promise<MockServer>;

export { type MockServer, startMockAnthropicServer };
