/**
 * Mock Anthropic Messages API server for testing.
 *
 * Implements POST /v1/messages with streaming SSE responses.
 * Set ANTHROPIC_BASE_URL=http://localhost:<port> and
 * ANTHROPIC_API_KEY=any-string to redirect Claude Code here.
 *
 * Usage:
 *   import { startMockAnthropicServer } from "@sna-sdk/core/test/mock-anthropic-server";
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
  requests: Array<{ model: string; messages: any[]; stream: boolean }>;
}

export async function startMockAnthropicServer(): Promise<MockServer> {
  const requests: MockServer["requests"] = [];

  const server = http.createServer(async (req, res) => {
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
      const body = JSON.parse(Buffer.concat(chunks).toString());

      requests.push({ model: body.model, messages: body.messages, stream: body.stream });

      // Extract last user message
      const lastUser = body.messages?.filter((m: any) => m.role === "user").pop();
      const userText = typeof lastUser?.content === "string"
        ? lastUser.content
        : lastUser?.content?.find((b: any) => b.type === "text")?.text ?? "hello";

      const replyText = `Mock reply to: ${userText.slice(0, 100)}`;
      const messageId = `msg_mock_${Date.now()}`;

      if (body.stream) {
        // Streaming SSE response
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

        // Send text in chunks
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
      } else {
        // Non-streaming response
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: messageId,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: replyText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }));
      }
      return;
    }

    // Unknown endpoint
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        server,
        close: () => server.close(),
        requests,
      });
    });
  });
}
