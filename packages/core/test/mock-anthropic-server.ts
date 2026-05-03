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

      // Extract last user message — Claude Code sends the user prompt as the
      // last user message in the conversation.
      const lastUser = body.messages?.filter((m: any) => m.role === "user").pop();
      let userText: string | undefined;

      if (typeof lastUser?.content === "string") {
        userText = lastUser.content;
      } else if (Array.isArray(lastUser?.content)) {
        // Take the LAST text block from the user message (the prompt is last)
        const textBlocks = lastUser.content.filter((b: any) => b.type === "text");
        if (textBlocks.length > 0) {
          userText = textBlocks[textBlocks.length - 1].text;
        }
      }

      // Fallback: take the LAST text content from ANY message
      if (!userText) {
        for (let i = (body.messages ?? []).length - 1; i >= 0; i--) {
          const msg = body.messages[i];
          if (typeof msg.content === "string") {
            userText = msg.content;
            break;
          } else if (Array.isArray(msg.content)) {
            for (let j = msg.content.length - 1; j >= 0; j--) {
              const block = msg.content[j];
              if (block.type === "text" && block.text) {
                userText = block.text;
                break;
              }
            }
            if (userText) break;
          }
        }
      }

      userText = userText ?? "hello";

      // Reverse the user text for test verification
      const reversedText = userText.split("").reverse().join("");
      const replyText = reversedText.slice(0, 100);

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
