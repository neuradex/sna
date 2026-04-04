#!/usr/bin/env node

// src/cli.ts
import { execSync, spawn } from "child_process";
import fs2 from "fs";
import path2 from "path";
import chalk from "chalk";

// src/instance.ts
import fs from "fs";
import path from "path";
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
  return path.join(process.cwd(), ".sna/instances");
}
function getInstanceDir(name) {
  return path.join(getInstancesDir(), name);
}
function writeInstanceMeta(name, meta) {
  const dir = getInstanceDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}
function readInstanceMeta(name) {
  try {
    const raw = fs.readFileSync(path.join(getInstanceDir(name), "meta.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function listInstances() {
  const dir = getInstancesDir();
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
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
  if (!fs.existsSync(dir)) return false;
  const meta = readInstanceMeta(name);
  if (meta?.pid && meta.status === "running") {
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

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
      const toolMatch = userText.match(/\[tool:(\w+)\]\s*(.*)/s);
      const hasToolResult = body.messages?.some(
        (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result")
      );
      const shouldToolUse = toolMatch && !hasToolResult;
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

// src/cli.ts
var SHELL = process.env.SHELL || "/bin/zsh";
function resolveClaudePath() {
  const stateDir = path2.join(process.cwd(), ".sna");
  const cached = path2.join(stateDir, "claude-path");
  if (fs2.existsSync(cached)) {
    const p = fs2.readFileSync(cached, "utf8").trim();
    if (p) {
      try {
        execSync(`test -x "${p}"`, { stdio: "pipe" });
        return p;
      } catch {
      }
    }
  }
  try {
    const resolved = execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
    if (resolved) return resolved;
  } catch {
  }
  for (const p of ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", `${process.env.HOME}/.local/bin/claude`]) {
    try {
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return p;
    } catch {
    }
  }
  return "claude";
}
function printInstanceInfo(name) {
  console.log();
  console.log(`  ${chalk.bold("instance:")}  ${chalk.cyan(name)}`);
  console.log();
  console.log(`  ${chalk.dim("all logs:")}   sna-test logs ${name}`);
  console.log(`  ${chalk.dim("follow:")}     sna-test logs ${name} -f`);
  console.log(`  ${chalk.dim("api logs:")}   sna-test logs ${name} --api`);
  console.log(`  ${chalk.dim("cleanup:")}    sna-test rm ${name}`);
  console.log();
}
function buildClaudeEnv(mockPort, instanceDir) {
  const configDir = path2.join(instanceDir, "claude-config");
  fs2.mkdirSync(configDir, { recursive: true });
  const apiKey = "sk-test-mock-sna";
  const keyTruncated = apiKey.slice(-20);
  const configFile = path2.join(configDir, ".claude.json");
  if (!fs2.existsSync(configFile)) {
    const cwd = process.cwd();
    fs2.writeFileSync(configFile, JSON.stringify({
      theme: "dark",
      hasCompletedOnboarding: true,
      customApiKeyResponses: {
        approved: [keyTruncated],
        rejected: []
      },
      projects: {
        [cwd]: { hasTrustDialogAccepted: true }
      }
    }, null, 2));
  }
  return {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://localhost:${mockPort}`,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_CONFIG_DIR: configDir
  };
}
function wireApiLog(mock, dir) {
  const logPath = path2.join(dir, "api.jsonl");
  const stream = fs2.createWriteStream(logPath, { flags: "a" });
  mock.onLog((line) => {
    stream.write(line + "\n");
  });
  return { logPath, close: () => stream.end() };
}
function formatApiLogEntry(entry) {
  const ts = chalk.dim(entry.ts.slice(11, 23));
  switch (entry.type) {
    case "request":
      return `${ts} ${chalk.yellow("REQ")}  ${entry.model ?? ""}  messages=${entry.messageCount ?? 0}  stream=${entry.stream ?? false}
${" ".repeat(14)}${chalk.dim("user:")} ${entry.userText ?? ""}` + (entry.systemPromptLength ? `
${" ".repeat(14)}${chalk.dim("system:")} ${entry.systemPromptLength} chars` : "");
    case "response":
      return `${ts} ${chalk.green("RES")}  ${entry.model ?? ""}  stream=${entry.stream ?? false}
${" ".repeat(14)}${chalk.dim("reply:")} ${entry.replyText ?? ""}`;
    case "error":
      return `${ts} ${chalk.red("ERR")}  ${entry.method ?? ""} ${entry.url ?? ""}  ${entry.error ?? ""}`;
    case "info":
      return `${ts} ${chalk.blue("INFO")} ${entry.message ?? ""}`;
    default:
      return `${ts} ${JSON.stringify(entry)}`;
  }
}
async function cmdClaude(args2) {
  const name = generateInstanceName();
  const dir = getInstanceDir(name);
  fs2.mkdirSync(dir, { recursive: true });
  const meta = {
    name,
    mode: args2.includes("-p") || args2.includes("--print") ? "oneshot" : "interactive",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "running"
  };
  writeInstanceMeta(name, meta);
  printInstanceInfo(name);
  console.log(`  Starting mock API...`);
  const mock = await startMockAnthropicServer();
  meta.mockPort = mock.port;
  writeInstanceMeta(name, meta);
  const apiLog = wireApiLog(mock, dir);
  console.log(`  Mock API ready on :${mock.port}`);
  console.log();
  const claudePath = resolveClaudePath();
  const env = buildClaudeEnv(mock.port, dir);
  const proc = spawn(claudePath, args2, {
    env,
    cwd: process.cwd(),
    stdio: "inherit"
  });
  meta.pid = proc.pid;
  writeInstanceMeta(name, meta);
  proc.on("exit", (code) => {
    meta.exitCode = code;
    meta.status = code === 0 ? "done" : "error";
    meta.pid = void 0;
    writeInstanceMeta(name, meta);
    apiLog.close();
    console.log();
    console.log(`  ${chalk.dim("\u2500".repeat(50))}`);
    console.log(`  ${chalk.bold("instance:")}  ${chalk.cyan(name)}  ${meta.status === "done" ? chalk.green("done") : chalk.red(`error (exit ${code})`)}`);
    console.log(`  ${chalk.dim("requests:")}  ${mock.requests.length}`);
    console.log(`  ${chalk.dim("cleanup:")}   sna-test rm ${name}`);
    mock.close();
    process.exit(code ?? 0);
  });
}
function cmdLs() {
  const instances = listInstances();
  if (instances.length === 0) {
    console.log("  No instances. Run: sna-test claude");
    return;
  }
  console.log();
  for (const inst of instances) {
    const status = inst.status === "running" ? chalk.green("running") : inst.status === "done" ? chalk.dim("done") : chalk.red("error");
    const date = inst.createdAt.slice(0, 19).replace("T", " ");
    const exit = inst.exitCode != null ? `  exit=${inst.exitCode}` : "";
    console.log(`  ${chalk.cyan(inst.name.padEnd(20))} ${inst.mode.padEnd(12)} ${chalk.dim(date)}  ${status}${exit}`);
  }
  console.log();
}
function cmdLogs(name, args2) {
  const meta = readInstanceMeta(name);
  if (!meta) {
    console.error(`  Instance "${name}" not found. Run: sna-test ls`);
    process.exit(1);
  }
  const dir = getInstanceDir(name);
  const follow = args2.includes("-f") || args2.includes("--follow");
  const apiOnly = args2.includes("--api");
  if (apiOnly) {
    const logFile = path2.join(dir, "api.jsonl");
    if (!fs2.existsSync(logFile)) {
      console.log("  No API logs.");
      return;
    }
    if (follow) {
      const tail = spawn("tail", ["-f", logFile], { stdio: ["ignore", "pipe", "inherit"] });
      tail.stdout.on("data", (d) => {
        for (const line of d.toString().split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            console.log(formatApiLogEntry(entry));
          } catch {
            console.log(line);
          }
        }
      });
      process.on("SIGINT", () => {
        tail.kill();
        process.exit(0);
      });
      return;
    }
    const content = fs2.readFileSync(logFile, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        console.log(formatApiLogEntry(entry));
      } catch {
        console.log(line);
      }
    }
    return;
  }
  const apiFile = path2.join(dir, "api.jsonl");
  if (fs2.existsSync(apiFile)) {
    if (follow) {
      const tail = spawn("tail", ["-f", apiFile], { stdio: ["ignore", "pipe", "inherit"] });
      tail.stdout.on("data", (d) => {
        for (const line of d.toString().split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            console.log(formatApiLogEntry(entry));
          } catch {
            console.log(line);
          }
        }
      });
      process.on("SIGINT", () => {
        tail.kill();
        process.exit(0);
      });
      return;
    }
    const content = fs2.readFileSync(apiFile, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        console.log(formatApiLogEntry(entry));
      } catch {
        console.log(line);
      }
    }
  } else {
    console.log("  (no logs yet)");
  }
}
function cmdRm(args2) {
  if (args2.includes("--all")) {
    const instances = listInstances();
    for (const inst of instances) {
      removeInstance(inst.name);
      console.log(`  removed ${inst.name}`);
    }
    if (instances.length === 0) console.log("  No instances to remove.");
    return;
  }
  const name = args2[0];
  if (!name) {
    console.error("  Usage: sna-test rm <name|--all>");
    process.exit(1);
  }
  if (removeInstance(name)) {
    console.log(`  removed ${name}`);
  } else {
    console.error(`  Instance "${name}" not found.`);
    process.exit(1);
  }
}
var args = process.argv.slice(2);
var cmd = args[0];
switch (cmd) {
  case "claude":
    cmdClaude(args.slice(1));
    break;
  case "ls":
    cmdLs();
    break;
  case "logs": {
    const name = args[1];
    if (!name) {
      console.error("  Usage: sna-test logs <name> [-f] [--api]");
      process.exit(1);
    }
    cmdLogs(name, args.slice(2));
    break;
  }
  case "rm":
    cmdRm(args.slice(1));
    break;
  default:
    console.log(`
  ${chalk.bold("sna-test")} \u2014 Testing utilities for SNA

  ${chalk.dim("Commands:")}
    sna-test claude [args...]        Launch Claude Code with mock Anthropic API
    sna-test claude -p "prompt"      Print mode (oneshot, non-interactive)
    sna-test ls                      List test instances
    sna-test logs <name>             View API request/response logs (parsed JSONL)
    sna-test logs <name> -f          Follow logs in real-time
    sna-test logs <name> --api       Same as default (explicit)
    sna-test rm <name>               Remove an instance
    sna-test rm --all                Remove all instances

  ${chalk.dim("Examples:")}
    sna-test claude                              Interactive TUI session
    sna-test claude -p "[tool:Bash] echo hello"  Test tool_use flow
    sna-test claude --permission-mode default     Test with specific permission mode
`);
}
