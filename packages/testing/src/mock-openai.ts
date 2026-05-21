/**
 * Mock OpenAI-compatible API server for deterministic runtime tests.
 *
 * Implements:
 *   - GET  /v1/models
 *   - POST /v1/chat/completions
 *   - POST /v1/responses
 *
 * The default response reverses the last user text, matching the Anthropic
 * mock's deterministic behavior. Tests can provide a fixed string or callback
 * via `responseText` when they need exact output.
 */

import http from "node:http";
import type net from "node:net";

export interface MockOpenAIModel {
  id: string;
  object?: "model";
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
}

export type MockOpenAIEndpoint = "models" | "chat.completions" | "responses" | "unknown";

export interface MockOpenAIRequest {
  timestamp: string;
  endpoint: MockOpenAIEndpoint;
  method: string;
  url: string;
  authorization?: string;
  model?: string;
  stream?: boolean;
  userText?: string;
  systemPromptLength?: number;
  requestBody?: any;
}

export interface MockOpenAILogEntry extends MockOpenAIRequest {
  type: "request" | "response" | "error" | "info";
  replyText?: string;
  error?: string;
  message?: string;
}

export interface MockOpenAIResponseContext {
  endpoint: "chat.completions" | "responses";
  requestBody: any;
  model: string;
  stream: boolean;
  userText: string;
  systemPrompt: string;
}

export interface MockOpenAIOptions {
  models?: MockOpenAIModel[];
  responseText?: string | ((ctx: MockOpenAIResponseContext) => string);
  chunkSize?: number;
}

export interface MockOpenAIServer {
  url: string;
  port: number;
  server: http.Server;
  requests: MockOpenAIRequest[];
  close: () => Promise<void>;
  /** Set a JSONL log writer. Each call receives one JSON line string. */
  onLog: (handler: (line: string) => void) => void;
}

const DEFAULT_MODELS: MockOpenAIModel[] = [
  { id: "gpt-5.4", object: "model", created: 0, owned_by: "openai" },
  { id: "gpt-5.4-mini", object: "model", created: 0, owned_by: "openai" },
  { id: "gpt-5.3-codex", object: "model", created: 0, owned_by: "openai" },
  { id: "gpt-5.2", object: "model", created: 0, owned_by: "openai" },
];

function now(): string {
  return new Date().toISOString();
}

function reverseText(text: string): string {
  return [...text].reverse().join("");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeModel(model: MockOpenAIModel): MockOpenAIModel {
  return {
    object: "model",
    created: 0,
    owned_by: "openai",
    ...model,
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
    } else if (typeof part?.text === "string") {
      parts.push(part.text);
    } else if (typeof part?.input_text === "string") {
      parts.push(part.input_text);
    }
  }
  return parts.join("");
}

function extractChatText(body: any): { userText: string; systemPrompt: string } {
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m: any) => m?.role === "user");
  const systemPrompt = messages
    .filter((m: any) => m?.role === "system" || m?.role === "developer")
    .map((m: any) => textFromContent(m.content))
    .filter(Boolean)
    .join("\n\n");
  return {
    userText: textFromContent(lastUser?.content),
    systemPrompt,
  };
}

function extractResponsesInputText(input: any): string {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  const userItems = input.filter((item) => item?.role === "user");
  const items = userItems.length > 0 ? userItems : input;
  const last = items[items.length - 1];
  if (!last) return "";
  if (typeof last === "string") return last;
  if (typeof last?.content === "string") return last.content;
  if (Array.isArray(last?.content)) return textFromContent(last.content);
  if (typeof last?.text === "string") return last.text;
  return "";
}

function extractResponsesText(body: any): { userText: string; systemPrompt: string } {
  const instructions = typeof body?.instructions === "string" ? body.instructions : "";
  const inputSystem = Array.isArray(body?.input)
    ? body.input
        .filter((item: any) => item?.role === "system" || item?.role === "developer")
        .map((item: any) => textFromContent(item.content))
        .filter(Boolean)
        .join("\n\n")
    : "";
  return {
    userText: extractResponsesInputText(body?.input),
    systemPrompt: [instructions, inputSystem].filter(Boolean).join("\n\n"),
  };
}

function chunksFor(text: string, size: number): string[] {
  const width = Math.max(1, size);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    chunks.push(text.slice(i, i + width));
  }
  return chunks.length > 0 ? chunks : [""];
}

function writeJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function writeSse(res: http.ServerResponse, event: string | null, payload: unknown): void {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`);
}

function responseTextFor(
  options: MockOpenAIOptions,
  ctx: MockOpenAIResponseContext,
): string {
  if (typeof options.responseText === "string") return options.responseText;
  if (typeof options.responseText === "function") return options.responseText(ctx);
  return reverseText(ctx.userText);
}

export async function startMockOpenAIServer(options: MockOpenAIOptions = {}): Promise<MockOpenAIServer> {
  const requests: MockOpenAIRequest[] = [];
  const models = (options.models ?? DEFAULT_MODELS).map(normalizeModel);
  const chunkSize = options.chunkSize ?? 8;
  let logHandler: ((line: string) => void) | null = null;

  function log(entry: MockOpenAILogEntry) {
    if (logHandler) logHandler(JSON.stringify(entry));
  }

  function record(
    req: http.IncomingMessage,
    endpoint: MockOpenAIEndpoint,
    body?: any,
    details?: Partial<MockOpenAIRequest>,
  ): MockOpenAIRequest {
    const entry: MockOpenAIRequest = {
      timestamp: now(),
      endpoint,
      method: req.method ?? "GET",
      url: req.url ?? "/",
      authorization: req.headers.authorization,
      requestBody: body,
      ...details,
    };
    requests.push(entry);
    log({ ...entry, type: "request" });
    return entry;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }

    const url = req.url ?? "/";

    if (req.method === "GET" && url.startsWith("/v1/models")) {
      record(req, "models");
      writeJson(res, 200, { object: "list", data: models });
      log({
        timestamp: now(),
        endpoint: "models",
        method: "GET",
        url,
        type: "response",
        message: `${models.length} models`,
      });
      return;
    }

    if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        record(req, "chat.completions");
        writeJson(res, 400, { error: { message: "invalid JSON" } });
        return;
      }

      const { userText, systemPrompt } = extractChatText(body);
      const model = String(body.model ?? "gpt-5.4");
      const stream = body.stream === true;
      record(req, "chat.completions", body, {
        model,
        stream,
        userText,
        systemPromptLength: systemPrompt.length || undefined,
      });

      const replyText = responseTextFor(options, {
        endpoint: "chat.completions",
        requestBody: body,
        model,
        stream,
        userText,
        systemPrompt,
      });
      const completionTokens = estimateTokens(replyText);
      const promptTokens = estimateTokens(`${systemPrompt}\n${userText}`);

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        const id = `chatcmpl_mock_${Date.now()}`;
        writeSse(res, null, {
          id,
          object: "chat.completion.chunk",
          model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });
        for (const chunk of chunksFor(replyText, chunkSize)) {
          writeSse(res, null, {
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
          });
        }
        writeSse(res, null, {
          id,
          object: "chat.completion.chunk",
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        });
        writeSse(res, null, "[DONE]");
        res.end();
      } else {
        writeJson(res, 200, {
          id: `chatcmpl_mock_${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: replyText },
            finish_reason: "stop",
          }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        });
      }
      log({
        timestamp: now(),
        endpoint: "chat.completions",
        method: "POST",
        url,
        type: "response",
        model,
        stream,
        userText,
        replyText: replyText.slice(0, 200),
      });
      return;
    }

    if (req.method === "POST" && url.startsWith("/v1/responses")) {
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        record(req, "responses");
        writeJson(res, 400, { error: { message: "invalid JSON" } });
        return;
      }

      const { userText, systemPrompt } = extractResponsesText(body);
      const model = String(body.model ?? "gpt-5.4");
      const stream = body.stream === true;
      record(req, "responses", body, {
        model,
        stream,
        userText,
        systemPromptLength: systemPrompt.length || undefined,
      });

      const replyText = responseTextFor(options, {
        endpoint: "responses",
        requestBody: body,
        model,
        stream,
        userText,
        systemPrompt,
      });
      const inputTokens = estimateTokens(`${systemPrompt}\n${userText}`);
      const outputTokens = estimateTokens(replyText);
      const usage = {
        input_tokens: inputTokens,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: outputTokens,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: inputTokens + outputTokens,
      };

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        const responseId = `resp_mock_${Date.now()}`;
        const itemId = `msg_mock_${Date.now()}`;
        const createdAt = Math.floor(Date.now() / 1000);
        let sequenceNumber = 0;
        writeSse(res, "response.created", {
          type: "response.created",
          sequence_number: sequenceNumber++,
          response: {
            id: responseId,
            object: "response",
            created_at: createdAt,
            status: "in_progress",
            model,
            output: [],
          },
        });
        writeSse(res, "response.output_item.added", {
          type: "response.output_item.added",
          sequence_number: sequenceNumber++,
          output_index: 0,
          item: { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] },
        });
        writeSse(res, "response.content_part.added", {
          type: "response.content_part.added",
          sequence_number: sequenceNumber++,
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
        for (const chunk of chunksFor(replyText, chunkSize)) {
          writeSse(res, "response.output_text.delta", {
            type: "response.output_text.delta",
            sequence_number: sequenceNumber++,
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            delta: chunk,
          });
        }
        writeSse(res, "response.output_text.done", {
          type: "response.output_text.done",
          sequence_number: sequenceNumber++,
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: replyText,
        });
        writeSse(res, "response.output_item.done", {
          type: "response.output_item.done",
          sequence_number: sequenceNumber++,
          output_index: 0,
          item: {
            id: itemId,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: replyText, annotations: [] }],
          },
        });
        writeSse(res, "response.completed", {
          type: "response.completed",
          sequence_number: sequenceNumber++,
          response: {
            id: responseId,
            object: "response",
            created_at: createdAt,
            status: "completed",
            model,
            output: [{
              id: itemId,
              type: "message",
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text: replyText, annotations: [] }],
            }],
            output_text: replyText,
            usage,
          },
        });
        writeSse(res, null, "[DONE]");
        res.end();
      } else {
        writeJson(res, 200, {
          id: `resp_mock_${Date.now()}`,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          status: "completed",
          model,
          output: [{
            id: `msg_mock_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: replyText }],
          }],
          output_text: replyText,
          usage,
        });
      }
      log({
        timestamp: now(),
        endpoint: "responses",
        method: "POST",
        url,
        type: "response",
        model,
        stream,
        userText,
        replyText: replyText.slice(0, 200),
      });
      return;
    }

    record(req, "unknown");
    writeJson(res, 404, { error: { message: "not found" } });
    log({
      timestamp: now(),
      endpoint: "unknown",
      method: req.method ?? "GET",
      url,
      type: "error",
      error: "not found",
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as net.AddressInfo;
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;
  log({
    timestamp: now(),
    endpoint: "unknown",
    method: "GET",
    url,
    type: "info",
    message: `Mock OpenAI API listening on :${port}`,
  });

  return {
    url,
    port,
    server,
    requests,
    close: () => new Promise<void>((resolve) => {
      log({
        timestamp: now(),
        endpoint: "unknown",
        method: "GET",
        url,
        type: "info",
        message: "Mock OpenAI API shutting down",
      });
      server.close(() => resolve());
    }),
    onLog: (handler) => { logHandler = handler; },
  };
}
