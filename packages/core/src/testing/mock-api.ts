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

import http from "http";
import net from "net";

export interface MockServer {
  port: number;
  server: http.Server;
  close: () => void;
  /** Messages received by the mock server */
  requests: Array<{ model: string; messages: any[]; stream: boolean; timestamp: string }>;
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export async function startMockAnthropicServer(): Promise<MockServer> {
  const requests: MockServer["requests"] = [];

  const server = http.createServer(async (req, res) => {
    console.log(`[${ts()}] ${req.method} ${req.url} ${req.headers["content-type"] ?? ""}`);

    // CORS
    if (req.method === "OPTIONS") {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }

    // Only handle messages endpoint
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString();
      let body: any;
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        console.log(`[${ts()}] ERROR: invalid JSON body: ${rawBody.slice(0, 200)}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }

      const entry = { model: body.model, messages: body.messages, stream: body.stream, timestamp: new Date().toISOString() };
      requests.push(entry);

      // Log request details — extract actual user text (skip system-reminder blocks)
      const lastUser = body.messages?.filter((m: any) => m.role === "user").pop();
      let userText = "(no text)";
      if (typeof lastUser?.content === "string") {
        userText = lastUser.content;
      } else if (Array.isArray(lastUser?.content)) {
        // Find the last text block that isn't a system-reminder
        const textBlocks = lastUser.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text as string);
        const realText = textBlocks.find((t: string) => !t.startsWith("<system-reminder>"));
        userText = realText ?? textBlocks[textBlocks.length - 1] ?? "(no text)";
      }
      console.log(`[${ts()}] REQ model=${body.model} stream=${body.stream} messages=${body.messages?.length} user="${userText.slice(0, 120)}"`);

      const replyText = [...userText].reverse().join("");
      const messageId = `msg_mock_${Date.now()}`;

      if (body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        const send = (event: string, data: any) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        send("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        });

        send("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        });

        const words = replyText.split(" ");
        for (const word of words) {
          send("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: word + " " },
          });
        }

        send("content_block_stop", { type: "content_block_stop", index: 0 });

        send("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: words.length * 2 },
        });

        send("message_stop", { type: "message_stop" });
        res.end();
        console.log(`[${ts()}] RES stream complete reply="${replyText.slice(0, 80)}"`);
      } else {
        const response = {
          id: messageId,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: replyText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        console.log(`[${ts()}] RES json reply="${replyText.slice(0, 80)}"`);
      }
      return;
    }

    // Unknown endpoint — log it
    console.log(`[${ts()}] 404 ${req.method} ${req.url}`);
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      console.log(`[${ts()}] Mock Anthropic API server listening on :${port}`);
      resolve({
        port,
        server,
        close: () => { console.log(`[${ts()}] Mock API server shutting down`); server.close(); },
        requests,
      });
    });
  });
}
