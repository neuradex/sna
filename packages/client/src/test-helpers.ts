/**
 * Test helpers — mock WS server + globalThis.WebSocket polyfill for Node.
 */

import { WebSocketServer, WebSocket as WsWebSocket, type WebSocket as WsType } from "ws";
import http from "http";

// Polyfill globalThis.WebSocket so SnaClient can use browser WebSocket API in Node
if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WsWebSocket;
}

export interface HttpRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

export interface MockServer {
  port: number;
  /** WS URL: `ws://localhost:<port>` */
  url: string;
  /** Base URL for SnaClient: `localhost:<port>` */
  host: string;
  wss: WebSocketServer;
  server: http.Server;
  /** All currently connected server-side sockets */
  clients: Set<WsType>;
  /** Last connected client (convenience) */
  lastClient: () => WsType;
  /** Send a JSON message to all connected clients */
  broadcast: (data: Record<string, unknown>) => void;
  /** Send a JSON message to the last connected client */
  sendTo: (ws: WsType, data: Record<string, unknown>) => void;
  /** Register handler for incoming messages from clients */
  onMessage: (handler: (ws: WsType, msg: Record<string, unknown>) => void) => void;
  /** All HTTP requests received since last clearHttpRequests() */
  httpRequests: HttpRequest[];
  /** Queue a response for the next incoming HTTP request */
  queueHttpResponse: (status: number, body: Record<string, unknown>) => void;
  /** Clear recorded HTTP requests */
  clearHttpRequests: () => void;
  /** Shut down the server */
  close: () => Promise<void>;
}

/**
 * Start a minimal WebSocket server on a random port.
 * Returns helpers for sending/receiving messages in tests.
 */
export function startMockWsServer(): Promise<MockServer> {
  return new Promise((resolve) => {
    const httpRequests: HttpRequest[] = [];
    const httpResponseQueue: Array<{ status: number; body: Record<string, unknown> }> = [];

    const server = http.createServer((req, res) => {
      // Collect request body
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try {
          const raw = Buffer.concat(chunks).toString();
          if (raw) body = JSON.parse(raw);
        } catch { /* no body or non-JSON */ }

        httpRequests.push({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          body,
        });

        const queued = httpResponseQueue.shift();
        const status = queued?.status ?? 200;
        const responseBody = queued?.body ?? { status: "ok" };
        const json = JSON.stringify(responseBody);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(json);
      });
    });

    const wss = new WebSocketServer({ server });
    const clients = new Set<WsType>();
    const messageHandlers: Array<(ws: WsType, msg: Record<string, unknown>) => void> = [];

    wss.on("connection", (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          for (const h of messageHandlers) h(ws, msg);
        } catch { /* ignore */ }
      });
    });

    server.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({
        port,
        url: `ws://localhost:${port}`,
        host: `localhost:${port}`,
        wss,
        server,
        clients,
        httpRequests,
        queueHttpResponse: (status, body) => { httpResponseQueue.push({ status, body }); },
        clearHttpRequests: () => { httpRequests.length = 0; },
        lastClient: () => {
          const arr = Array.from(clients);
          return arr[arr.length - 1];
        },
        broadcast: (data) => {
          const json = JSON.stringify(data);
          for (const ws of clients) {
            if (ws.readyState === ws.OPEN) ws.send(json);
          }
        },
        sendTo: (ws, data) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
        },
        onMessage: (handler) => { messageHandlers.push(handler); },
        close: () => new Promise<void>((res) => {
          for (const ws of clients) ws.close();
          wss.close(() => server.close(() => res()));
        }),
      });
    });
  });
}

/** Wait for a condition with timeout */
export function waitFor(fn: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/** Wait a fixed number of ms */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
