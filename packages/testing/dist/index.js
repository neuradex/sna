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
      const entry = { model: body.model, messages: body.messages, stream: body.stream, timestamp: now() };
      requests.push(entry);
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

// src/oneshot.ts
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
async function runOneshot(cliArgs) {
  const ROOT = process.cwd();
  const STATE_DIR = path.join(ROOT, ".sna");
  const args = cliArgs ?? process.argv.slice(2);
  let claudePath = "claude";
  const cachedPath = path.join(STATE_DIR, "claude-path");
  if (fs.existsSync(cachedPath)) {
    claudePath = fs.readFileSync(cachedPath, "utf8").trim() || claudePath;
  }
  const mock = await startMockAnthropicServer();
  const mockConfigDir = path.join(STATE_DIR, "mock-claude-oneshot");
  fs.mkdirSync(mockConfigDir, { recursive: true });
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
  const stdoutPath = path.join(STATE_DIR, "mock-claude-stdout.log");
  const stderrPath = path.join(STATE_DIR, "mock-claude-stderr.log");
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
    fs.writeFileSync(stdoutPath, stdout);
    fs.writeFileSync(stderrPath, stderr);
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
    console.log(`  api log:  ${path.join(STATE_DIR, "mock-api-last-request.json")}`);
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
import fs2 from "fs";
import path2 from "path";
import crypto from "crypto";
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
  return arr[crypto.randomInt(arr.length)];
}
function generateInstanceName() {
  return `${randomPick(ADJECTIVES)}-${randomPick(NOUNS)}`;
}
function getInstancesDir() {
  return path2.join(process.cwd(), ".sna/instances");
}
function getInstanceDir(name) {
  return path2.join(getInstancesDir(), name);
}
function writeInstanceMeta(name, meta) {
  const dir = getInstanceDir(name);
  fs2.mkdirSync(dir, { recursive: true });
  fs2.writeFileSync(path2.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}
function readInstanceMeta(name) {
  try {
    const raw = fs2.readFileSync(path2.join(getInstanceDir(name), "meta.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function listInstances() {
  const dir = getInstancesDir();
  if (!fs2.existsSync(dir)) return [];
  const entries = fs2.readdirSync(dir, { withFileTypes: true });
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
  if (!fs2.existsSync(dir)) return false;
  const meta = readInstanceMeta(name);
  if (meta?.pid && meta.status === "running") {
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {
    }
  }
  fs2.rmSync(dir, { recursive: true, force: true });
  return true;
}
export {
  generateInstanceName,
  getInstanceDir,
  getInstancesDir,
  listInstances,
  readInstanceMeta,
  removeInstance,
  runOneshot,
  startMockAnthropicServer,
  writeInstanceMeta
};
