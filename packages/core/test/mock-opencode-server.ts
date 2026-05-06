/**
 * Mock OpenCode HTTP server.
 *
 * OpenCodeProvider talks to a real `opencode serve` over HTTP via
 * @opencode-ai/sdk. For tests we want to verify what the provider SENDS
 * (e.g. that history was prepended to the first prompt parts) without
 * running real OpenCode. This stub:
 *   1. Listens on a free port and exposes the SDK-relevant routes:
 *        POST /session                           → create session
 *        POST /session/:id/message               → sync prompt (we use 200)
 *        POST /session/:id/prompt_async          → async prompt (204)
 *        POST /session/:id/abort                 → abort
 *        DELETE /session/:id                     → delete
 *        POST /session/:id/permissions/:permID   → permission response
 *        GET /event                              → SSE stream
 *   2. Records every received request body+path on a JSONL log
 *   3. Drives an SSE event sequence on prompt: server.connected (initial),
 *      message.part.updated × N, message.updated, session.idle.
 *
 * Tests use the returned `url` to construct a SnaClient/OpencodeClient
 * directly, OR pass the url to OpenCodeProvider via the
 * `providerOptions.serverUrl` short-circuit (skips the inner spawn).
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MockOpenCodeRequest {
  method: string;
  url: string;
  body: unknown;
}

export interface MockOpenCodeServer {
  /** Absolute http://127.0.0.1:PORT base URL. */
  url: string;
  /** Path to JSONL request log. */
  requestsLog: string;
  /** Read all captured requests. */
  readRequests(): MockOpenCodeRequest[];
  /** Subset of captured requests for a path predicate. */
  requestsFor(predicate: (r: MockOpenCodeRequest) => boolean): MockOpenCodeRequest[];
  /** Drop captured requests + reset SSE event queue. */
  reset(): void;
  /** Programmatically broadcast an SSE event to all connected clients. */
  emit(event: { type: string; properties?: Record<string, unknown> }): void;
  /** Tear down server + log file. */
  close(): Promise<void>;
}

interface SessionState {
  id: string;
  messageCounter: number;
}

export async function startMockOpenCodeServer(): Promise<MockOpenCodeServer> {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-opencode-log-"));
  const requestsLog = path.join(logDir, "requests.jsonl");
  fs.writeFileSync(requestsLog, "");

  const sessions = new Map<string, SessionState>();
  let sessionCounter = 0;

  // SSE clients
  const sseClients = new Set<http.ServerResponse>();

  const writeSse = (res: http.ServerResponse, payload: { type: string; properties?: Record<string, unknown> }) => {
    try {
      // Match OpenCode's nd-JSON event framing — `event: <type>\ndata: <json>\n\n`.
      // The SDK iterates by parsing data lines as JSON; the `properties` field
      // carries the typed payload.
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      /* client disconnected */
    }
  };

  const emit = (payload: { type: string; properties?: Record<string, unknown> }) => {
    for (const client of sseClients) writeSse(client, payload);
  };

  const appendLog = (entry: MockOpenCodeRequest) => {
    fs.appendFileSync(requestsLog, JSON.stringify(entry) + "\n");
  };

  const readBody = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve(undefined);
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });

  // Synthesize a complete prompt cycle on /prompt_async. Matches the
  // observed wire format of real opencode 1.14: an empty text part is
  // created via message.part.updated, then deltas arrive as separate
  // `message.part.delta` events keyed by partID, then a finalized
  // message.part.updated (with time.end) marks the part as complete,
  // followed by message.updated and finally session.idle.
  const synthesizePromptCycle = (sessionId: string) => {
    const messageId = `m${++sessions.get(sessionId)!.messageCounter}`;
    const partId = `p${messageId}_text`;
    // 1. Initial empty text part — registers partID → type
    setTimeout(() => emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: partId, sessionID: sessionId, messageID: messageId,
          type: "text", text: "",
          time: { start: Date.now() },
        },
      },
    }), 3);
    // 2. Token deltas as standalone events
    setTimeout(() => emit({
      type: "message.part.delta",
      properties: {
        sessionID: sessionId, messageID: messageId, partID: partId,
        field: "text", delta: "Hello",
      },
    }), 5);
    setTimeout(() => emit({
      type: "message.part.delta",
      properties: {
        sessionID: sessionId, messageID: messageId, partID: partId,
        field: "text", delta: " world",
      },
    }), 10);
    // 3. Final text part (no delta, time.end set) — drives "assistant".
    setTimeout(() => emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: partId, sessionID: sessionId, messageID: messageId,
          type: "text", text: "Hello world",
          time: { start: Date.now() - 50, end: Date.now() },
        },
      },
    }), 12);
    // Final assistant message
    setTimeout(() => emit({
      type: "message.updated",
      properties: {
        info: {
          id: messageId,
          sessionID: sessionId,
          role: "assistant",
          time: { created: Date.now() - 50, completed: Date.now() },
          parentID: "u1",
          modelID: "claude-sonnet-4-6",
          providerID: "anthropic",
          mode: "build",
          path: { cwd: process.cwd(), root: process.cwd() },
          cost: 0,
          tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      },
    }), 15);
    // Idle
    setTimeout(() => emit({
      type: "session.idle",
      properties: { sessionID: sessionId },
    }), 20);
  };

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const body = method === "GET" ? undefined : await readBody(req);
    appendLog({ method, url, body });

    // SSE
    if (method === "GET" && url.startsWith("/event")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sseClients.add(res);
      writeSse(res, { type: "server.connected", properties: {} });
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // Treat /doc as a no-op 200 so SDK probes succeed.
    if (method === "GET" && url.startsWith("/doc")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }

    // POST /session  → create
    if (method === "POST" && (url === "/session" || url.startsWith("/session?"))) {
      const id = `mock-sess-${++sessionCounter}`;
      sessions.set(id, { id, messageCounter: 0 });
      const session = {
        id,
        projectID: "p1",
        directory: process.cwd(),
        title: "mock",
        version: "0.0.0",
        time: { created: Date.now(), updated: Date.now() },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(session));
      // Notify SSE listeners that a session was created.
      setTimeout(() => emit({
        type: "session.created",
        properties: { info: session },
      }), 1);
      return;
    }

    // POST /session/:id/prompt_async  → 204, drives SSE cycle
    {
      const m = url.match(/^\/session\/([^\/]+)\/prompt_async(?:\?.*)?$/);
      if (method === "POST" && m) {
        const sessionId = m[1];
        if (!sessions.has(sessionId)) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(204).end();
        synthesizePromptCycle(sessionId);
        return;
      }
    }

    // POST /session/:id/message  → sync prompt (returns AssistantMessage shape)
    {
      const m = url.match(/^\/session\/([^\/]+)\/message(?:\?.*)?$/);
      if (method === "POST" && m) {
        const sessionId = m[1];
        if (!sessions.has(sessionId)) {
          res.writeHead(404).end();
          return;
        }
        const messageId = `m${++sessions.get(sessionId)!.messageCounter}`;
        const out = {
          info: {
            id: messageId,
            sessionID: sessionId,
            role: "assistant",
            time: { created: Date.now(), completed: Date.now() },
            parentID: "u1",
            modelID: "claude-sonnet-4-6",
            providerID: "anthropic",
            mode: "build",
            path: { cwd: process.cwd(), root: process.cwd() },
            cost: 0,
            tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [
            {
              id: `p${messageId}`,
              sessionID: sessionId,
              messageID: messageId,
              type: "text",
              text: "Hello world",
            },
          ],
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
        return;
      }
    }

    // POST /session/:id/abort
    {
      const m = url.match(/^\/session\/([^\/]+)\/abort(?:\?.*)?$/);
      if (method === "POST" && m) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("true");
        return;
      }
    }

    // POST /session/:id/permissions/:permId
    {
      const m = url.match(/^\/session\/([^\/]+)\/permissions\/([^\/]+)(?:\?.*)?$/);
      if (method === "POST" && m) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("true");
        return;
      }
    }

    // DELETE /session/:id
    {
      const m = url.match(/^\/session\/([^\/]+)(?:\?.*)?$/);
      if (method === "DELETE" && m) {
        sessions.delete(m[1]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("true");
        return;
      }
    }

    // Catch-all: respond OK so noisy SDK probes don't tank the test.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock-opencode: no port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    url: baseUrl,
    requestsLog,
    readRequests() {
      const raw = fs.readFileSync(requestsLog, "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as MockOpenCodeRequest);
    },
    requestsFor(predicate) {
      return this.readRequests().filter(predicate);
    },
    reset() {
      fs.writeFileSync(requestsLog, "");
    },
    emit,
    async close() {
      for (const client of sseClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try { fs.rmSync(logDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}
