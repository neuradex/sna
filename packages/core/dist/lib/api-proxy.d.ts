import http from 'http';

/**
 * api-proxy.ts — Transparent Anthropic API proxy.
 *
 * Sits between Claude Code and the real Anthropic API.
 * Captures the system prompt from requests and forwards everything transparently.
 *
 * Usage:
 *   const proxy = await startApiProxy({
 *     onSystemPrompt: (system) => { // log to Langfuse },
 *   });
 *   // Set env before spawning Claude Code:
 *   process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxy.port}`;
 *   // ... later ...
 *   proxy.close();
 */

interface ProxiedRequest {
    model: string;
    stream: boolean;
    system: unknown | null;
    messages: unknown[] | null;
    messageCount: number;
}
interface ApiProxyOptions {
    /** Called for every proxied /v1/messages request with full details. */
    onRequest?: (info: ProxiedRequest) => void;
    /** Target Anthropic API base URL. Defaults to https://api.anthropic.com */
    targetBaseUrl?: string;
}
interface ApiProxy {
    port: number;
    server: http.Server;
    close: () => void;
    /** The captured system prompt (set after first request). */
    systemPrompt: unknown | null;
}
declare function startApiProxy(opts?: ApiProxyOptions): Promise<ApiProxy>;

export { type ApiProxy, type ApiProxyOptions, type ProxiedRequest, startApiProxy };
