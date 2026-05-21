// src/mock-api.ts
import http from "http";
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function startMockAnthropicServer() {
  const requests = [];
  let logHandler = null;
  function log(entry) {
    const line = JSON.stringify(entry);
    if (logHandler) logHandler(line);
  }
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString();
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        log({ ts: now(), type: "error", method: "POST", url: req.url, error: "invalid JSON body" });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      const lastUser = body.messages?.filter((m) => m.role === "user").pop();
      let userText = "(no text)";
      if (typeof lastUser?.content === "string") {
        userText = lastUser.content;
      } else if (Array.isArray(lastUser?.content)) {
        const textBlocks = lastUser.content.filter((b) => b.type === "text").map((b) => b.text);
        const realText = textBlocks.find((t) => !t.startsWith("<system-reminder>"));
        userText = realText ?? textBlocks[textBlocks.length - 1] ?? "(no text)";
      }
      const sysText = typeof body.system === "string" ? body.system : body.system ? JSON.stringify(body.system) : "";
      const entry = {
        model: body.model,
        messages: body.messages,
        stream: body.stream,
        timestamp: now(),
        userText,
        systemPromptLength: sysText.length || void 0,
        requestBody: body
      };
      requests.push(entry);
      log({
        ts: now(),
        type: "request",
        method: "POST",
        url: req.url ?? "/v1/messages",
        model: body.model,
        stream: body.stream,
        messageCount: body.messages?.length,
        userText: userText.slice(0, 200),
        systemPromptLength: sysText.length || void 0,
        requestBody: body
      });
      const messageId = `msg_mock_${Date.now()}`;
      const toolUseId = `toolu_mock_${Date.now()}`;
      let toolMatch = null;
      if (Array.isArray(lastUser?.content)) {
        for (const block of lastUser.content) {
          if (block.type === "text") {
            const m = block.text.match(/\[tool:(\w+)\]\s*(.*)/s);
            if (m) {
              toolMatch = m;
              break;
            }
          }
        }
      } else if (typeof lastUser?.content === "string") {
        toolMatch = lastUser.content.match(/\[tool:(\w+)\]\s*(.*)/s);
      }
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      const shouldToolUse = Boolean(toolMatch) && hasTools;
      const toolName = toolMatch?.[1] ?? "";
      const toolArg = toolMatch?.[2]?.trim() ?? "";
      const replyText = shouldToolUse ? "" : [...userText].reverse().join("");
      if (body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        const send = (event, data) => {
          res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
        };
        const stopReason = shouldToolUse ? "tool_use" : "end_turn";
        send("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
          }
        });
        if (shouldToolUse) {
          const toolInput = toolName === "Bash" ? { command: toolArg || "echo hello" } : toolName === "Edit" ? { file_path: toolArg || "/tmp/test.txt", old_string: "old", new_string: "new" } : toolName === "Write" ? { file_path: toolArg || "/tmp/test.txt", content: "test content" } : { input: toolArg };
          send("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: toolUseId, name: toolName, input: {} }
          });
          const inputJson = JSON.stringify(toolInput);
          const chunkSize = 20;
          for (let i = 0; i < inputJson.length; i += chunkSize) {
            send("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: inputJson.slice(i, i + chunkSize) }
            });
          }
          send("content_block_stop", { type: "content_block_stop", index: 0 });
          log({ ts: now(), type: "response", model: body.model, stream: true, replyText: `[tool_use] ${toolName}(${inputJson})` });
        } else {
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
        const content = shouldToolUse ? [{ type: "tool_use", id: toolUseId, name: toolName, input: { command: toolArg || "echo hello" } }] : [{ type: "text", text: replyText }];
        const response = {
          id: messageId,
          type: "message",
          role: "assistant",
          model: body.model,
          content,
          stop_reason: shouldToolUse ? "tool_use" : "end_turn",
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        log({
          ts: now(),
          type: "response",
          model: body.model,
          stream: false,
          replyText: shouldToolUse ? `[tool_use] ${toolName}` : replyText.slice(0, 200)
        });
      }
      return;
    }
    log({ ts: now(), type: "error", method: req.method, url: req.url ?? "", error: "not found" });
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      log({ ts: now(), type: "info", message: `Mock Anthropic API listening on :${port}` });
      resolve({
        port,
        server,
        close: () => {
          log({ ts: now(), type: "info", message: "Mock API shutting down" });
          server.close();
        },
        requests,
        onLog: (handler) => {
          logHandler = handler;
        }
      });
    });
  });
}

// src/mock-openai.ts
import http2 from "http";
var DEFAULT_MODELS = [
  { id: "gpt-5.4", object: "model", created: 0, owned_by: "openai" },
  { id: "gpt-5.4-mini", object: "model", created: 0, owned_by: "openai" },
  { id: "gpt-5.3-codex", object: "model", created: 0, owned_by: "openai" },
  { id: "gpt-5.2", object: "model", created: 0, owned_by: "openai" }
];
function now2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function reverseText(text) {
  return [...text].reverse().join("");
}
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}
function normalizeModel(model) {
  return {
    object: "model",
    created: 0,
    owned_by: "openai",
    ...model
  };
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
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
function extractChatText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  const systemPrompt = messages.filter((m) => m?.role === "system" || m?.role === "developer").map((m) => textFromContent(m.content)).filter(Boolean).join("\n\n");
  return {
    userText: textFromContent(lastUser?.content),
    systemPrompt
  };
}
function extractResponsesInputText(input) {
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
function extractResponsesText(body) {
  const instructions = typeof body?.instructions === "string" ? body.instructions : "";
  const inputSystem = Array.isArray(body?.input) ? body.input.filter((item) => item?.role === "system" || item?.role === "developer").map((item) => textFromContent(item.content)).filter(Boolean).join("\n\n") : "";
  return {
    userText: extractResponsesInputText(body?.input),
    systemPrompt: [instructions, inputSystem].filter(Boolean).join("\n\n")
  };
}
function chunksFor(text, size) {
  const width = Math.max(1, size);
  const chunks = [];
  for (let i = 0; i < text.length; i += width) {
    chunks.push(text.slice(i, i + width));
  }
  return chunks.length > 0 ? chunks : [""];
}
function writeJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}
function writeSse(res, event, payload) {
  if (event) res.write(`event: ${event}
`);
  res.write(`data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}

`);
}
function responseTextFor(options, ctx) {
  if (typeof options.responseText === "string") return options.responseText;
  if (typeof options.responseText === "function") return options.responseText(ctx);
  return reverseText(ctx.userText);
}
async function startMockOpenAIServer(options = {}) {
  const requests = [];
  const models = (options.models ?? DEFAULT_MODELS).map(normalizeModel);
  const chunkSize = options.chunkSize ?? 8;
  let logHandler = null;
  function log(entry) {
    if (logHandler) logHandler(JSON.stringify(entry));
  }
  function record(req, endpoint, body, details) {
    const entry = {
      timestamp: now2(),
      endpoint,
      method: req.method ?? "GET",
      url: req.url ?? "/",
      authorization: req.headers.authorization,
      requestBody: body,
      ...details
    };
    requests.push(entry);
    log({ ...entry, type: "request" });
    return entry;
  }
  const server = http2.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      });
      res.end();
      return;
    }
    const url2 = req.url ?? "/";
    if (req.method === "GET" && url2.startsWith("/v1/models")) {
      record(req, "models");
      writeJson(res, 200, { object: "list", data: models });
      log({
        timestamp: now2(),
        endpoint: "models",
        method: "GET",
        url: url2,
        type: "response",
        message: `${models.length} models`
      });
      return;
    }
    if (req.method === "POST" && url2.startsWith("/v1/chat/completions")) {
      let body;
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
        systemPromptLength: systemPrompt.length || void 0
      });
      const replyText = responseTextFor(options, {
        endpoint: "chat.completions",
        requestBody: body,
        model,
        stream,
        userText,
        systemPrompt
      });
      const completionTokens = estimateTokens(replyText);
      const promptTokens = estimateTokens(`${systemPrompt}
${userText}`);
      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*"
        });
        const id = `chatcmpl_mock_${Date.now()}`;
        writeSse(res, null, {
          id,
          object: "chat.completion.chunk",
          model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
        });
        for (const chunk of chunksFor(replyText, chunkSize)) {
          writeSse(res, null, {
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
          });
        }
        writeSse(res, null, {
          id,
          object: "chat.completion.chunk",
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
        });
        writeSse(res, null, "[DONE]");
        res.end();
      } else {
        writeJson(res, 200, {
          id: `chatcmpl_mock_${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1e3),
          model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: replyText },
            finish_reason: "stop"
          }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        });
      }
      log({
        timestamp: now2(),
        endpoint: "chat.completions",
        method: "POST",
        url: url2,
        type: "response",
        model,
        stream,
        userText,
        replyText: replyText.slice(0, 200)
      });
      return;
    }
    if (req.method === "POST" && url2.startsWith("/v1/responses")) {
      let body;
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
        systemPromptLength: systemPrompt.length || void 0
      });
      const replyText = responseTextFor(options, {
        endpoint: "responses",
        requestBody: body,
        model,
        stream,
        userText,
        systemPrompt
      });
      const inputTokens = estimateTokens(`${systemPrompt}
${userText}`);
      const outputTokens = estimateTokens(replyText);
      const usage = {
        input_tokens: inputTokens,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: outputTokens,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: inputTokens + outputTokens
      };
      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*"
        });
        const responseId = `resp_mock_${Date.now()}`;
        const itemId = `msg_mock_${Date.now()}`;
        writeSse(res, "response.created", {
          type: "response.created",
          response: { id: responseId, object: "response", status: "in_progress", model }
        });
        writeSse(res, "response.output_item.added", {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: itemId, type: "message", role: "assistant", content: [] }
        });
        writeSse(res, "response.content_part.added", {
          type: "response.content_part.added",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "" }
        });
        for (const chunk of chunksFor(replyText, chunkSize)) {
          writeSse(res, "response.output_text.delta", {
            type: "response.output_text.delta",
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            delta: chunk
          });
        }
        writeSse(res, "response.output_text.done", {
          type: "response.output_text.done",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: replyText
        });
        writeSse(res, "response.output_item.done", {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            id: itemId,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: replyText }]
          }
        });
        writeSse(res, "response.completed", {
          type: "response.completed",
          response: {
            id: responseId,
            object: "response",
            status: "completed",
            model,
            output_text: replyText,
            usage
          }
        });
        writeSse(res, null, "[DONE]");
        res.end();
      } else {
        writeJson(res, 200, {
          id: `resp_mock_${Date.now()}`,
          object: "response",
          created_at: Math.floor(Date.now() / 1e3),
          status: "completed",
          model,
          output: [{
            id: `msg_mock_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: replyText }]
          }],
          output_text: replyText,
          usage
        });
      }
      log({
        timestamp: now2(),
        endpoint: "responses",
        method: "POST",
        url: url2,
        type: "response",
        model,
        stream,
        userText,
        replyText: replyText.slice(0, 200)
      });
      return;
    }
    record(req, "unknown");
    writeJson(res, 404, { error: { message: "not found" } });
    log({
      timestamp: now2(),
      endpoint: "unknown",
      method: req.method ?? "GET",
      url: url2,
      type: "error",
      error: "not found"
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;
  log({
    timestamp: now2(),
    endpoint: "unknown",
    method: "GET",
    url,
    type: "info",
    message: `Mock OpenAI API listening on :${port}`
  });
  return {
    url,
    port,
    server,
    requests,
    close: () => new Promise((resolve) => {
      log({
        timestamp: now2(),
        endpoint: "unknown",
        method: "GET",
        url,
        type: "info",
        message: "Mock OpenAI API shutting down"
      });
      server.close(() => resolve());
    }),
    onLog: (handler) => {
      logHandler = handler;
    }
  };
}

// src/claude-env.ts
import fs from "fs";
import path from "path";
var SAFE_ENV_KEYS = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TMPDIR"];
function compactEnv(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== void 0)
  );
}
function baseEnv(options) {
  const source = options.env ?? process.env;
  if (options.inheritEnv !== false) {
    return compactEnv(source);
  }
  const clean = {};
  for (const key of SAFE_ENV_KEYS) clean[key] = source[key];
  return compactEnv(clean);
}
function createClaudeMockEnv(options) {
  const cwd = options.cwd ?? process.cwd();
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const configDir = options.configDir ?? path.join(cwd, ".sna", "mock-claude");
  const configFile = path.join(configDir, ".claude.json");
  fs.mkdirSync(configDir, { recursive: true });
  if (options.overwrite || !fs.existsSync(configFile)) {
    const projects = {};
    for (const projectPath of [cwd, ...options.trustedProjectPaths ?? []]) {
      projects[projectPath] = { hasTrustDialogAccepted: true };
    }
    fs.writeFileSync(configFile, JSON.stringify({
      theme: "dark",
      hasCompletedOnboarding: true,
      customApiKeyResponses: {
        approved: [apiKey.slice(-20)],
        rejected: []
      },
      projects
    }, null, 2));
  }
  const env = {
    ...baseEnv(options),
    ANTHROPIC_BASE_URL: options.anthropicBaseUrl,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_CONFIG_DIR: configDir,
    ...compactEnv(options.extraEnv ?? {})
  };
  return {
    env,
    cwd,
    configDir,
    configFile,
    apiKey,
    anthropicBaseUrl: options.anthropicBaseUrl
  };
}

// src/codex-env.ts
import fs2 from "fs";
import path2 from "path";
var SAFE_ENV_KEYS2 = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TMPDIR"];
function compactEnv2(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== void 0)
  );
}
function baseEnv2(options) {
  const source = options.env ?? process.env;
  if (options.inheritEnv !== false) {
    return compactEnv2(source);
  }
  const clean = {};
  for (const key of SAFE_ENV_KEYS2) clean[key] = source[key];
  return compactEnv2(clean);
}
function quoteToml(value) {
  return JSON.stringify(value);
}
function createCodexMockEnv(options) {
  const cwd = options.cwd ?? process.cwd();
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const codexHome = options.codexHome ?? path2.join(cwd, ".sna", "mock-codex");
  const configFile = path2.join(codexHome, "config.toml");
  const providerId = options.providerId ?? "mock-openai";
  const model = options.model ?? "gpt-5.4";
  const baseUrl = options.openAIBaseUrl.replace(/\/+$/, "");
  fs2.mkdirSync(codexHome, { recursive: true });
  if (options.overwrite || !fs2.existsSync(configFile)) {
    const projects = [cwd, ...options.trustedProjectPaths ?? []].map((projectPath) => `[projects.${quoteToml(projectPath)}]
trust_level = "trusted"`).join("\n\n");
    fs2.writeFileSync(configFile, [
      `model_provider = ${quoteToml(providerId)}`,
      `model = ${quoteToml(model)}`,
      `approval_policy = "never"`,
      `sandbox_mode = "danger-full-access"`,
      ``,
      `[model_providers.${providerId}]`,
      `name = ${quoteToml(providerId)}`,
      `base_url = ${quoteToml(`${baseUrl}/v1`)}`,
      `env_key = "OPENAI_API_KEY"`,
      `wire_api = "responses"`,
      ``,
      projects,
      ``
    ].join("\n"));
  }
  const env = {
    ...baseEnv2(options),
    CODEX_HOME: codexHome,
    OPENAI_API_KEY: apiKey,
    ...compactEnv2(options.extraEnv ?? {})
  };
  return {
    env,
    cwd,
    codexHome,
    configFile,
    apiKey,
    openAIBaseUrl: baseUrl,
    providerId,
    model
  };
}

// src/opencode-config.ts
import crypto from "crypto";
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
function hashConfig(config) {
  return crypto.createHash("sha256").update(stableJson(config)).digest("hex").slice(0, 16);
}
function createOpenCodeMockConfig(options) {
  const providerId = options.providerId ?? "sna-mock";
  const modelId = options.modelId ?? "sna-model";
  const model = `${providerId}/${modelId}`;
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const baseUrl = options.openAIBaseUrl.replace(/\/+$/, "");
  const agent = options.agent ?? "build";
  const maxSteps = options.maxSteps ?? 1;
  const contextWindow = options.contextWindow ?? 8192;
  const outputLimit = options.outputLimit ?? 4096;
  const agentConfig = {
    model,
    maxSteps,
    tools: {}
  };
  const config = {
    enabled_providers: [providerId],
    model,
    small_model: model,
    plugin: [],
    agent: {
      build: agentConfig,
      [agent]: agentConfig
    },
    provider: {
      [providerId]: {
        npm: "@ai-sdk/openai-compatible",
        name: "SNA Mock OpenAI",
        options: {
          baseURL: `${baseUrl}/v1`,
          apiKey
        },
        models: {
          [modelId]: {
            name: options.modelName ?? "SNA Mock Model",
            tool_call: false,
            attachment: false,
            reasoning: false,
            temperature: true,
            cost: { input: 0, output: 0 },
            limit: { context: contextWindow, output: outputLimit }
          }
        }
      }
    },
    ...options.extraConfig ?? {}
  };
  return {
    config,
    providerOptions: {
      modelProviderId: providerId,
      opencodeConfig: config,
      opencodeConfigHash: hashConfig(config),
      agent
    },
    model,
    providerId,
    modelId,
    apiKey,
    openAIBaseUrl: baseUrl
  };
}

// src/mock-cli.ts
import fs3 from "fs";
import os from "os";
import path3 from "path";
function executableScript(dir, name, body) {
  const script = path3.join(dir, `${name}.js`);
  fs3.writeFileSync(script, body);
  fs3.chmodSync(script, 493);
  return script;
}
function createCliHandle(dir, command, invocationsFile) {
  return {
    command,
    dir,
    invocationsFile,
    readInvocations() {
      if (!fs3.existsSync(invocationsFile)) return [];
      return fs3.readFileSync(invocationsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    },
    close() {
      fs3.rmSync(dir, { recursive: true, force: true });
    }
  };
}
function openAIUrl(input) {
  return typeof input === "string" ? input : input.url;
}
function anthropicUrl(input) {
  return typeof input === "string" ? input : `http://127.0.0.1:${input.port}`;
}
function createMockCodexExecCli(input, options = {}) {
  const dir = fs3.mkdtempSync(path3.join(os.tmpdir(), "sna-mock-codex-"));
  const invocationsFile = path3.join(dir, "invocations.jsonl");
  const endpoint = openAIUrl(input);
  const apiKey = options.apiKey ?? "sk-codex-test";
  const command = executableScript(dir, "codex", `#!/usr/bin/env node
const fs = require("node:fs");
const endpoint = ${JSON.stringify(endpoint)};
const apiKey = ${JSON.stringify(apiKey)};
const invocationsFile = ${JSON.stringify(invocationsFile)};
const args = process.argv.slice(2);

function record() {
  const env = {};
  for (const key of ["SNA_SESSION_ID", "LOOM_SESSION_ID", "LOOM_API_URL", "MOCK_OPENAI_URL", "OPENAI_API_KEY"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  fs.appendFileSync(invocationsFile, JSON.stringify({ argv: args, cwd: process.cwd(), env, timestamp: new Date().toISOString() }) + "\\n");
}

function configValue(raw) {
  const idx = raw.indexOf("=");
  if (idx === -1) return [raw, ""];
  return [raw.slice(0, idx), raw.slice(idx + 1)];
}

function decodeConfigValue(value) {
  try { return JSON.parse(value); } catch { return value; }
}

async function main() {
  record();
  if (args[0] === "--version") {
    console.log("codex-cli mock-openai 0.0.0");
    return;
  }
  if (args[0] === "debug" && args[1] === "models") {
    const res = await fetch(endpoint + "/v1/models", {
      headers: { Authorization: "Bearer " + apiKey },
    });
    const body = await res.json();
    console.log(JSON.stringify({
      models: body.data.map((m) => ({
        slug: m.id,
        display_name: String(m.id).toUpperCase(),
        visibility: "list",
        supported_in_api: true,
      })),
    }));
    return;
  }
  if (args[0] !== "exec") {
    console.error("unsupported codex mock args: " + args.join(" "));
    process.exit(2);
  }

  let model = "codex-default";
  let prompt = args[args.length - 1] ?? "";
  let instructions;
  let effort;
  let serviceTier;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model") {
      model = args[++i] ?? model;
      continue;
    }
    if (arg === "-c") {
      const [key, value] = configValue(args[++i] ?? "");
      if (key === "developer_instructions") instructions = decodeConfigValue(value);
      if (key === "model_reasoning_effort") effort = value;
      if (key === "service_tier") serviceTier = value;
    }
  }

  const request = {
    model,
    input: prompt,
    ...(instructions ? { instructions } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
    ...(serviceTier ? { service_tier: serviceTier } : {}),
  };
  const res = await fetch(endpoint + "/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    console.log(JSON.stringify({ type: "turn.failed", error: { message: await res.text() } }));
    process.exit(1);
  }
  const body = await res.json();
  const text = body.output_text
    ?? body.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("")
    ?? "";

  const midpoint = Math.max(1, Math.floor(text.length / 2));
  console.log(JSON.stringify({ type: "agent_message.delta", delta: text.slice(0, midpoint) }));
  console.log(JSON.stringify({ type: "agent_message.delta", delta: text.slice(midpoint) }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
  console.log(JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: body.usage?.input_tokens ?? 0,
      cached_input_tokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: body.usage?.output_tokens ?? 0,
    },
  }));
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
`);
  return createCliHandle(dir, command, invocationsFile);
}
function createMockClaudeCli(input, options = {}) {
  const dir = fs3.mkdtempSync(path3.join(os.tmpdir(), "sna-mock-claude-"));
  const invocationsFile = path3.join(dir, "invocations.jsonl");
  const endpoint = anthropicUrl(input);
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const defaultModel = options.defaultModel ?? "claude-mock";
  const command = executableScript(dir, "claude", `#!/usr/bin/env node
const fs = require("node:fs");
const endpoint = ${JSON.stringify(endpoint)};
const apiKey = ${JSON.stringify(apiKey)};
const defaultModel = ${JSON.stringify(defaultModel)};
const invocationsFile = ${JSON.stringify(invocationsFile)};
const args = process.argv.slice(2);

function record() {
  const env = {};
  for (const key of ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "SNA_SESSION_ID", "LOOM_SESSION_ID", "LOOM_API_URL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  fs.appendFileSync(invocationsFile, JSON.stringify({ argv: args, cwd: process.cwd(), env, timestamp: new Date().toISOString() }) + "\\n");
}

function textFromAnthropicContent(content) {
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}

function usageFor(text) {
  const tokens = Math.max(1, Math.ceil(String(text).length / 4));
  return {
    input_tokens: tokens,
    output_tokens: tokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

function emitJsonLine(value) {
  console.log(JSON.stringify(value));
}

function parseArgs() {
  let outputFormat = "text";
  let inputFormat = "text";
  let printMode = false;
  let model = defaultModel;
  let systemPrompt = "";
  let appendSystemPrompt = "";
  let prompt = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version") return { version: true };
    if (arg === "-p" || arg === "--print") {
      printMode = true;
      continue;
    }
    if (arg === "--verbose" || arg === "--include-partial-messages" || arg === "--no-session-persistence") continue;
    if (arg === "--output-format") {
      outputFormat = args[++i] ?? outputFormat;
      continue;
    }
    if (arg === "--input-format") {
      inputFormat = args[++i] ?? inputFormat;
      continue;
    }
    if (arg === "--model") {
      model = args[++i] ?? model;
      continue;
    }
    if (arg === "--system-prompt") {
      systemPrompt = args[++i] ?? "";
      continue;
    }
    if (arg === "--append-system-prompt") {
      appendSystemPrompt = args[++i] ?? "";
      continue;
    }
    if (arg === "--permission-mode" || arg === "--effort") {
      i++;
      continue;
    }
    prompt = arg;
  }
  return {
    outputFormat,
    inputFormat,
    printMode,
    model,
    system: [systemPrompt, appendSystemPrompt].filter(Boolean).join("\\n\\n"),
    prompt,
  };
}

async function completeAnthropic(parsed, prompt) {
  const res = await fetch(endpoint + "/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      model: parsed.model,
      system: parsed.system || undefined,
      stream: false,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const error = await res.text();
    console.error(error);
    process.exit(1);
  }
  const body = await res.json();
  return textFromAnthropicContent(body.content);
}

function resultPayload(parsed, text, usage, modelUsage) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: "mock-claude-session",
    duration_ms: 1,
    duration_api_ms: 1,
    total_cost_usd: 0,
    usage,
    modelUsage,
  };
}

function emitStream(parsed, text) {
  const usage = usageFor(text);
  const modelUsage = {
    [parsed.model]: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
    },
  };

  const messageId = "msg_mock_cli_" + Date.now();
  emitJsonLine({ type: "stream_event", event: { type: "message_start", message: { id: messageId, type: "message", role: "assistant", model: parsed.model, content: [] } } });
  emitJsonLine({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  let streamed = "";
  for (const word of text.split(" ")) {
    const delta = word + " ";
    streamed += delta;
    emitJsonLine({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } } });
  }
  emitJsonLine({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  emitJsonLine({ type: "stream_event", event: { type: "message_stop" } });
  emitJsonLine(resultPayload(parsed, streamed, usage, modelUsage));
}

function userTextFromStreamJson(line) {
  const msg = JSON.parse(line);
  if (msg.type !== "user") return null;
  const content = msg.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "string" ? part : (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

async function runPersistent(parsed) {
  emitJsonLine({ type: "system", subtype: "init", session_id: "mock-claude-session", model: parsed.model, apiKeySource: "ANTHROPIC_API_KEY" });
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split("\\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const text = userTextFromStreamJson(line);
      if (text == null) continue;
      emitStream(parsed, await completeAnthropic(parsed, text));
    }
  }
}

async function main() {
  record();
  const parsed = parseArgs();
  if (parsed.version) {
    console.log("Claude Code mock-anthropic 0.0.0");
    return;
  }

  if (parsed.inputFormat === "stream-json" && !parsed.printMode) {
    await runPersistent(parsed);
    return;
  }

  const text = await completeAnthropic(parsed, parsed.prompt);

  if (parsed.outputFormat === "json") {
    const usage = usageFor(text);
    const modelUsage = {
      [parsed.model]: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      },
    };
    console.log(JSON.stringify(resultPayload(parsed, text, usage, modelUsage)));
    return;
  }

  if (parsed.outputFormat === "stream-json") {
    emitJsonLine({ type: "system", subtype: "init", session_id: "mock-claude-session", model: parsed.model, apiKeySource: "ANTHROPIC_API_KEY" });
    emitStream(parsed, text);
    return;
  }

  console.log(text);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
`);
  return createCliHandle(dir, command, invocationsFile);
}

// src/harness.ts
async function readSseData(res) {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/event-stream")) {
    throw new Error(`Expected text/event-stream response, got ${contentType || "(missing content-type)"}`);
  }
  const raw = await res.text();
  return raw.split("\n\n").flatMap((chunk) => chunk.split("\n")).filter((line) => line.startsWith("data: ")).map((line) => line.slice("data: ".length));
}
async function waitForRequest(source, predicate = () => true, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1e3;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const found = source.requests.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for mock request after ${timeoutMs}ms`);
}
async function withMockAnthropicServer(fn) {
  const mock = await startMockAnthropicServer();
  try {
    return await fn(mock);
  } finally {
    mock.close();
  }
}
async function withMockOpenAIServer(optionsOrFn, maybeFn) {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (!fn) throw new Error("withMockOpenAIServer requires a callback");
  const mock = await startMockOpenAIServer(options);
  try {
    return await fn(mock);
  } finally {
    await mock.close();
  }
}

// src/oneshot.ts
import { spawn } from "child_process";
import fs4 from "fs";
import path4 from "path";
async function runOneshot(cliArgs) {
  const ROOT = process.cwd();
  const STATE_DIR = path4.join(ROOT, ".sna");
  const args = cliArgs ?? process.argv.slice(2);
  let claudePath = "claude";
  const cachedPath = path4.join(STATE_DIR, "claude-path");
  if (fs4.existsSync(cachedPath)) {
    claudePath = fs4.readFileSync(cachedPath, "utf8").trim() || claudePath;
  }
  const mock = await startMockAnthropicServer();
  const mockConfigDir = path4.join(STATE_DIR, "mock-claude-oneshot");
  fs4.mkdirSync(mockConfigDir, { recursive: true });
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TERM: process.env.TERM ?? "xterm-256color",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    ANTHROPIC_BASE_URL: `http://localhost:${mock.port}`,
    ANTHROPIC_API_KEY: "sk-test-mock-oneshot",
    CLAUDE_CONFIG_DIR: mockConfigDir
  };
  const stdoutPath = path4.join(STATE_DIR, "mock-claude-stdout.log");
  const stderrPath = path4.join(STATE_DIR, "mock-claude-stderr.log");
  const proc = spawn(claudePath, args, {
    env,
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => {
    stdout += d.toString();
  });
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  proc.stdout.pipe(process.stdout);
  proc.on("exit", (code) => {
    fs4.writeFileSync(stdoutPath, stdout);
    fs4.writeFileSync(stderrPath, stderr);
    console.log(`
${"\u2500".repeat(60)}`);
    console.log(`Mock API: ${mock.requests.length} request(s)`);
    for (const req of mock.requests) {
      console.log(`  model=${req.model} stream=${req.stream} messages=${req.messages?.length}`);
    }
    console.log(`
Log files:`);
    console.log(`  stdout:   ${stdoutPath}`);
    console.log(`  stderr:   ${stderrPath}`);
    console.log(`  api log:  ${path4.join(STATE_DIR, "mock-api-last-request.json")}`);
    console.log(`  config:   ${mockConfigDir}`);
    console.log(`  exit:     ${code}`);
    mock.close();
    process.exit(code ?? 0);
  });
  setTimeout(() => {
    proc.kill();
  }, 6e4);
}

// src/instance.ts
import fs5 from "fs";
import path5 from "path";
import crypto2 from "crypto";
var ADJECTIVES = [
  "happy",
  "calm",
  "bold",
  "warm",
  "cool",
  "swift",
  "bright",
  "quiet",
  "gentle",
  "keen",
  "brave",
  "lucky",
  "vivid",
  "wise",
  "proud",
  "kind",
  "wild",
  "sharp",
  "soft",
  "clear",
  "quick",
  "light",
  "fair",
  "free"
];
var NOUNS = [
  "bear",
  "fox",
  "wolf",
  "hawk",
  "deer",
  "owl",
  "seal",
  "hare",
  "lynx",
  "crow",
  "dove",
  "wren",
  "moth",
  "frog",
  "bee",
  "elk",
  "ram",
  "ray",
  "cod",
  "ant",
  "eel",
  "jay",
  "yak",
  "puma"
];
function randomPick(arr) {
  return arr[crypto2.randomInt(arr.length)];
}
function generateInstanceName() {
  return `${randomPick(ADJECTIVES)}-${randomPick(NOUNS)}`;
}
function getInstancesDir() {
  return path5.join(process.cwd(), ".sna/instances");
}
function getInstanceDir(name) {
  return path5.join(getInstancesDir(), name);
}
function writeInstanceMeta(name, meta) {
  const dir = getInstanceDir(name);
  fs5.mkdirSync(dir, { recursive: true });
  fs5.writeFileSync(path5.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}
function readInstanceMeta(name) {
  try {
    const raw = fs5.readFileSync(path5.join(getInstanceDir(name), "meta.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function listInstances() {
  const dir = getInstancesDir();
  if (!fs5.existsSync(dir)) return [];
  const entries = fs5.readdirSync(dir, { withFileTypes: true });
  const instances = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readInstanceMeta(entry.name);
    if (meta) {
      if (meta.status === "running" && meta.pid) {
        try {
          process.kill(meta.pid, 0);
        } catch {
          meta.status = "done";
          writeInstanceMeta(entry.name, meta);
        }
      }
      instances.push(meta);
    }
  }
  return instances.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function removeInstance(name) {
  const dir = getInstanceDir(name);
  if (!fs5.existsSync(dir)) return false;
  const meta = readInstanceMeta(name);
  if (meta?.pid && meta.status === "running") {
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {
    }
  }
  fs5.rmSync(dir, { recursive: true, force: true });
  return true;
}
export {
  createClaudeMockEnv,
  createCodexMockEnv,
  createMockClaudeCli,
  createMockCodexExecCli,
  createOpenCodeMockConfig,
  generateInstanceName,
  getInstanceDir,
  getInstancesDir,
  listInstances,
  readInstanceMeta,
  readSseData,
  removeInstance,
  runOneshot,
  startMockAnthropicServer,
  startMockOpenAIServer,
  waitForRequest,
  withMockAnthropicServer,
  withMockOpenAIServer,
  writeInstanceMeta
};
