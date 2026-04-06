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

import http from "http";
import https from "https";
import net from "net";
import { URL } from "url";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProxiedRequest {
  model: string;
  stream: boolean;
  system: unknown | null;
  messages: unknown[] | null;
  messageCount: number;
}

export interface ApiProxyOptions {
  /** Called for every proxied /v1/messages request with full details. */
  onRequest?: (info: ProxiedRequest) => void;
  /** Target Anthropic API base URL. Defaults to https://api.anthropic.com */
  targetBaseUrl?: string;
}

export interface ApiProxy {
  port: number;
  server: http.Server;
  close: () => void;
  /** The captured system prompt (set after first request). */
  systemPrompt: unknown | null;
}

// ── Implementation ──────────────────────────────────────────────────────────

export async function startApiProxy(opts: ApiProxyOptions = {}): Promise<ApiProxy> {
  const targetBase = opts.targetBaseUrl ?? "https://api.anthropic.com";
  let systemPrompt: unknown | null = null;

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      res.end();
      return;
    }

    // Read request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks);

    // Extract system prompt from /v1/messages
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      try {
        const body = JSON.parse(rawBody.toString());
        if (body.system) systemPrompt = body.system;

        opts.onRequest?.({
          model: body.model ?? "unknown",
          stream: !!body.stream,
          system: body.system ?? null,
          messages: body.messages ?? null,
          messageCount: body.messages?.length ?? 0,
        });
      } catch {
        // JSON parse failed — still forward the request
      }
    }

    // Forward to real Anthropic API
    const target = new URL(req.url ?? "/", targetBase);
    const isHttps = target.protocol === "https:";
    const transport = isHttps ? https : http;

    // Copy headers, skip host
    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") continue;
      if (val) headers[key] = Array.isArray(val) ? val.join(", ") : val;
    }
    headers["host"] = target.host;

    const proxyReq = transport.request(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        // Pipe response headers + body back
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `proxy error: ${err.message}` }));
    });

    // Send body
    proxyReq.end(rawBody);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        server,
        close: () => server.close(),
        get systemPrompt() { return systemPrompt; },
      });
    });
  });
}
