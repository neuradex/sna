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

import http from "http";
import fs from "fs";
import path from "path";
import net from "net";

export interface MockServer {
  port: number;
  server: http.Server;
  close: () => void;
  requests: Array<{ model: string; messages: any[]; stream: boolean; timestamp: string }>;
  /** Set a JSONL log writer. Each call receives one JSON line string (no trailing newline). */
  onLog: (handler: (line: string) => void) => void;
}

export interface MockLogEntry {
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

function now(): string {
  return new Date().toISOString();
}

export async function startMockAnthropicServer(): Promise<MockServer> {
  const requests: MockServer["requests"] = [];
  let logHandler: ((line: string) => void) | null = null;

  function log(entry: MockLogEntry) {
    const line = JSON.stringify(entry);
    if (logHandler) logHandler(line);
  }

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
      const rawBody = Buffer.concat(chunks).toString();
      let body: any;
      try {
        body = JSON.parse(rawBody);
      } catch {
        log({ ts: now(), type: "error", method: "POST", url: req.url, error: "invalid JSON body" });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }

      const entry = { model: body.model, messages: body.messages, stream: body.stream, timestamp: now() };
      requests.push(entry);

      // Extract user text for log summary
      const lastUser = body.messages?.filter((m: any) => m.role === "user").pop();
      let userText = "(no text)";
      if (typeof lastUser?.content === "string") {
        userText = lastUser.content;
      } else if (Array.isArray(lastUser?.content)) {
        const textBlocks = lastUser.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text as string);
        const realText = textBlocks.find((t: string) => !t.startsWith("<system-reminder>"));
        userText = realText ?? textBlocks[textBlocks.length - 1] ?? "(no text)";
      }

      const sysText = typeof body.system === "string" ? body.system : (body.system ? JSON.stringify(body.system) : "");

      log({
        ts: now(),
        type: "request",
        method: "POST",
        url: req.url ?? "/v1/messages",
        model: body.model,
        stream: body.stream,
        messageCount: body.messages?.length,
        userText: userText.slice(0, 200),
        systemPromptLength: sysText.length || undefined,
        requestBody: body,
      });

      const messageId = `msg_mock_${Date.now()}`;
      const toolUseId = `toolu_mock_${Date.now()}`;

      // Detect [tool:ToolName] trigger in user text → respond with tool_use
      const toolMatch = userText.match(/\[tool:(\w+)\]\s*(.*)/s);

      // Check if this is a follow-up after tool_result (second turn)
      const hasToolResult = body.messages?.some((m: any) =>
        m.role === "user" && Array.isArray(m.content) &&
        m.content.some((b: any) => b.type === "tool_result")
      );

      // Determine response mode:
      // 1. Has tool trigger AND no tool_result yet → tool_use response
      // 2. Has tool_result (follow-up turn) → final text response
      // 3. No trigger → normal text response
      const shouldToolUse = toolMatch && !hasToolResult;
      const toolName = toolMatch?.[1] ?? "";
      const toolArg = toolMatch?.[2]?.trim() ?? "";
      const replyText = shouldToolUse ? "" : [...userText].reverse().join("");

      if (body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        const send = (event: string, data: any) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const stopReason = shouldToolUse ? "tool_use" : "end_turn";

        send("message_start", {
          type: "message_start",
          message: {
            id: messageId, type: "message", role: "assistant", model: body.model,
            content: [], stop_reason: null,
            usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        });

        if (shouldToolUse) {
          // Build tool input based on tool name
          const toolInput = toolName === "Bash"
            ? { command: toolArg || "echo hello" }
            : toolName === "Edit"
              ? { file_path: toolArg || "/tmp/test.txt", old_string: "old", new_string: "new" }
              : toolName === "Write"
                ? { file_path: toolArg || "/tmp/test.txt", content: "test content" }
                : { input: toolArg };

          // Matches real Anthropic API streaming format:
          // 1. content_block_start with empty input (CC initializes as "")
          // 2. input_json_delta chunks (CC accumulates as string, parses on stop)
          // 3. content_block_stop
          send("content_block_start", {
            type: "content_block_start", index: 0,
            content_block: { type: "tool_use", id: toolUseId, name: toolName, input: {} },
          });

          // Send input as partial_json chunks (mimics real API chunking)
          const inputJson = JSON.stringify(toolInput);
          const chunkSize = 20;
          for (let i = 0; i < inputJson.length; i += chunkSize) {
            send("content_block_delta", {
              type: "content_block_delta", index: 0,
              delta: { type: "input_json_delta", partial_json: inputJson.slice(i, i + chunkSize) },
            });
          }

          send("content_block_stop", { type: "content_block_stop", index: 0 });

          log({ ts: now(), type: "response", model: body.model, stream: true, replyText: `[tool_use] ${toolName}(${inputJson})` });
        } else {
          // Normal text response
          send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });

          const words = replyText.split(" ");
          for (const word of words) {
            send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: word + " " } });
          }

          send("content_block_stop", { type: "content_block_stop", index: 0 });

          log({ ts: now(), type: "response", model: body.model, stream: true, replyText: replyText.slice(0, 200) });
        }

        send("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
        send("message_stop", { type: "message_stop" });
        res.end();
      } else {
        // Non-streaming
        const content = shouldToolUse
          ? [{ type: "tool_use", id: toolUseId, name: toolName, input: { command: toolArg || "echo hello" } }]
          : [{ type: "text", text: replyText }];

        const response = {
          id: messageId, type: "message", role: "assistant", model: body.model,
          content,
          stop_reason: shouldToolUse ? "tool_use" : "end_turn",
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));

        log({
          ts: now(), type: "response", model: body.model, stream: false,
          replyText: shouldToolUse ? `[tool_use] ${toolName}` : replyText.slice(0, 200),
        });
      }
      return;
    }

    // Unknown endpoint
    log({ ts: now(), type: "error", method: req.method, url: req.url ?? "", error: "not found" });
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      log({ ts: now(), type: "info", message: `Mock Anthropic API listening on :${port}` });
      resolve({
        port,
        server,
        close: () => { log({ ts: now(), type: "info", message: "Mock API shutting down" }); server.close(); },
        requests,
        onLog: (handler) => { logHandler = handler; },
      });
    });
  });
}
