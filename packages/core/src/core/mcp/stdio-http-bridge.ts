/**
 * stdio-http-bridge.ts — Expose a stdio MCP server over Streamable HTTP.
 *
 * Some agent runtimes (any ACP-speaking client today: grok, future entries)
 * can only consume MCP via HTTP or SSE — they reject stdio command-spawn
 * descriptors. Loom and other SNA consumers, however, ship their MCP tools
 * as stdio executables (`node loom-tools.mjs`, `npx mcp-server-foo`, …).
 *
 * This module bridges the two: spawn the stdio child once per session,
 * stand up a localhost HTTP endpoint speaking the Streamable HTTP MCP
 * transport, and forward JSON-RPC traffic between them. Each bridge owns
 * its own port and child process; tearing down the session disposes both.
 *
 * Why hand-rolled instead of the SDK? The SDK ships
 * `StreamableHTTPServerTransport` for hosting an in-process `McpServer`
 * instance — we'd need a separate proxy `McpServer` plus the SDK's
 * stdio Client to chain them. The traffic we actually need to relay is
 * unmodified JSON-RPC, so a thin line-delimited forwarder is simpler and
 * has fewer moving parts. We mirror the SDK's wire shape (SSE-framed
 * responses) so the same clients accept us.
 *
 * Scope / limits:
 *   - Forward client→server requests/notifications: yes.
 *   - Forward server→client requests (sampling, elicitation): no, dropped
 *     with a log line. Add when a concrete need shows up.
 *   - Concurrency: multiple in-flight requests are matched by JSON-RPC id.
 *   - Batches: per JSON-RPC spec, each item is forwarded individually and
 *     responses returned in order.
 */

import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { logger } from "../../lib/logger.js";

export interface StdioMcpConfig {
  command: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface BridgeHandle {
  /** Streamable-HTTP MCP endpoint, e.g. "http://127.0.0.1:54321/mcp". */
  url: string;
  /** Kill the stdio child and close the HTTP server. Idempotent. */
  dispose: () => void;
}

/** How long we wait for the stdio child to answer a single JSON-RPC request. */
const REQUEST_TIMEOUT_MS = 60_000;

export async function bridgeStdioMcpToHttp(name: string, cfg: StdioMcpConfig): Promise<BridgeHandle> {
  // ── 1. Spawn the stdio MCP child.
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...(cfg.env ?? {}) })) {
    if (typeof v === "string") childEnv[k] = v;
  }

  const child: ChildProcess = spawn(cfg.command, cfg.args ?? [], {
    cwd: cfg.cwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Stderr is diagnostic-only; surface to SNA's logger so failures aren't silent.
  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrTail += text;
    if (stderrTail.length > 4_096) stderrTail = stderrTail.slice(-2_048);
    if (/error/i.test(text)) {
      logger.log("agent", `mcp-bridge[${name}] stderr: ${text.trim().slice(0, 400)}`);
    }
  });

  // ── 2. Track in-flight requests by id; resolve when the child answers.
  type Resolver = (msg: unknown) => void;
  const pending = new Map<string | number, Resolver>();

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    let msg: { id?: string | number; method?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    // Server-initiated request/notification — no client correlation. Log and
    // drop; we don't currently bridge the server→client direction.
    if (msg && typeof msg === "object" && msg.method !== undefined && msg.id === undefined) {
      logger.log("agent", `mcp-bridge[${name}] dropped server notification: ${msg.method}`);
      return;
    }
    if (msg && typeof msg === "object" && msg.id !== undefined && pending.has(msg.id)) {
      const resolve = pending.get(msg.id)!;
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  child.on("exit", (code) => {
    // Resolve any in-flight requests with an error so HTTP callers don't hang.
    const tail = stderrTail.trim().split("\n").slice(-3).join(" | ");
    for (const resolve of pending.values()) {
      resolve({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: `mcp child '${name}' exited code=${code}${tail ? ` stderr=${tail}` : ""}` },
      });
    }
    pending.clear();
  });

  function forwardToChild(req: { id?: string | number }, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> | null {
    // Notifications have no id and expect no response.
    if (req.id === undefined) {
      child.stdin?.write(JSON.stringify(req) + "\n");
      return null;
    }
    return new Promise((resolve) => {
      const id = req.id!;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ jsonrpc: "2.0", id, error: { code: -32000, message: "mcp child response timeout" } });
        }
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin?.write(JSON.stringify(req) + "\n");
    });
  }

  // ── 3. HTTP server speaking Streamable HTTP MCP (SSE-framed responses).
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/mcp") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", async () => {
      let reqJson: unknown;
      try {
        reqJson = body ? JSON.parse(body) : null;
      } catch (err) {
        res.writeHead(200, sseHeaders);
        res.write(sseFrame({ jsonrpc: "2.0", error: { code: -32700, message: `parse error: ${err}` }, id: null }));
        res.end();
        return;
      }

      const isBatch = Array.isArray(reqJson);
      const items = (isBatch ? reqJson : [reqJson]) as Array<{ id?: string | number; method?: string }>;
      const summary = items.map((i) => `${i.method ?? "?"}#${i.id ?? "notif"}`).join(",");
      logger.log("agent", `mcp-bridge[${name}] POST <- ${summary}`);

      // Fire all forwards in parallel; preserve ordering for the response.
      const settled = await Promise.all(items.map((item) => forwardToChild(item)));
      const responses = settled.filter((r): r is unknown => r !== null);
      logger.log("agent", `mcp-bridge[${name}] POST -> ${responses.length} responses`);

      // Per Streamable HTTP MCP spec: a POST consisting only of notifications
      // (or responses) carries no response body and the server must return
      // `202 Accepted`. Returning an empty SSE stream instead breaks at least
      // grok's client (`unexpected server response: expect accepted or json,
      // got Sse(None)`), which then kills the session.
      if (responses.length === 0) {
        res.writeHead(202).end();
        return;
      }

      res.writeHead(200, sseHeaders);
      if (isBatch) {
        for (const r of responses) res.write(sseFrame(r));
      } else {
        res.write(sseFrame(responses[0]));
      }
      res.end();
    });
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve(`http://127.0.0.1:${addr.port}/mcp`);
      } else {
        reject(new Error("mcp-bridge: server.address() returned no port"));
      }
    });
  });

  logger.log("agent", `mcp-bridge[${name}] ready at ${url} (pid=${child.pid})`);

  return {
    url,
    dispose: () => {
      try { rl.close(); } catch {}
      try { child.kill("SIGTERM"); } catch {}
      try { server.close(); } catch {}
      pending.clear();
    },
  };
}

const sseHeaders = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
} as const;

function sseFrame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}
