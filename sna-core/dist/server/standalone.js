// src/server/standalone.ts
import { serve } from "@hono/node-server";
import { Hono as Hono3 } from "hono";
import { cors } from "hono/cors";

// src/server/index.ts
import { Hono as Hono2 } from "hono";

// src/server/routes/events.ts
import { streamSSE } from "hono/streaming";

// src/db/schema.ts
import { createRequire } from "module";
import path from "path";
var require2 = createRequire(path.join(process.cwd(), "node_modules", "_"));
var BetterSqlite3 = require2("better-sqlite3");
var DB_PATH = path.join(process.cwd(), "data/app.db");
var _db = null;
function getDb() {
  if (!_db) {
    _db = new BetterSqlite3(DB_PATH);
    _db.pragma("journal_mode = WAL");
    initSchema(_db);
  }
  return _db;
}
function migrateSkillEvents(db) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='skill_events'"
  ).get();
  if (row?.sql?.includes("CHECK(type IN")) {
    db.exec("DROP TABLE IF EXISTS skill_events");
  }
}
function initSchema(db) {
  migrateSkillEvents(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      skill      TEXT NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      data       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill);
    CREATE INDEX IF NOT EXISTS idx_skill_events_created ON skill_events(created_at);
  `);
}

// src/server/routes/events.ts
var POLL_INTERVAL_MS = 500;
var KEEPALIVE_INTERVAL_MS = 15e3;
function eventsRoute(c) {
  const sinceParam = c.req.query("since");
  let lastId = sinceParam ? parseInt(sinceParam) : -1;
  if (lastId === -1) {
    const db = getDb();
    const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get();
    lastId = row.maxId ?? 0;
  }
  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    const keepaliveTimer = setInterval(async () => {
      if (closed) {
        clearInterval(keepaliveTimer);
        return;
      }
      try {
        await stream.writeSSE({ data: "", event: "keepalive" });
      } catch {
        closed = true;
        clearInterval(keepaliveTimer);
      }
    }, KEEPALIVE_INTERVAL_MS);
    while (!closed) {
      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT id, skill, type, message, data, created_at
          FROM skill_events
          WHERE id > ?
          ORDER BY id ASC
          LIMIT 50
        `).all(lastId);
        for (const row of rows) {
          if (closed) break;
          await stream.writeSSE({ data: JSON.stringify(row) });
          lastId = row.id;
        }
      } catch {
      }
      await stream.sleep(POLL_INTERVAL_MS);
    }
    clearInterval(keepaliveTimer);
  });
}

// src/server/routes/emit.ts
async function emitRoute(c) {
  const { skill, type, message, data } = await c.req.json();
  if (!skill || !type || !message) {
    return c.json({ error: "missing fields" }, 400);
  }
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO skill_events (skill, type, message, data) VALUES (?, ?, ?, ?)`
  ).run(skill, type, message, data ?? null);
  return c.json({ id: result.lastInsertRowid });
}

// src/server/routes/run.ts
import { spawn } from "child_process";
import { streamSSE as streamSSE2 } from "hono/streaming";
var ROOT = process.cwd();
function createRunRoute(commands) {
  return function runRoute(c) {
    const skill = c.req.query("skill") ?? "";
    const cmd = commands[skill];
    if (!cmd) {
      return c.text(`data: unknown skill: ${skill}

data: [done]

`, 200, {
        "Content-Type": "text/event-stream"
      });
    }
    return streamSSE2(c, async (stream) => {
      await stream.writeSSE({ data: `$ ${cmd.slice(1).join(" ")}` });
      const child = spawn(cmd[0], cmd.slice(1), {
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: "0" }
      });
      const write = (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) stream.writeSSE({ data: line });
        }
      };
      child.stdout.on("data", write);
      child.stderr.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim() && !line.startsWith(">")) stream.writeSSE({ data: line });
        }
      });
      await new Promise((resolve) => {
        child.on("close", async (code) => {
          await stream.writeSSE({ data: `[exit ${code ?? 0}]` });
          await stream.writeSSE({ data: "[done]" });
          resolve();
        });
        child.on("error", async (err) => {
          await stream.writeSSE({ data: `Error: ${err.message}` });
          await stream.writeSSE({ data: "[done]" });
          resolve();
        });
      });
    });
  };
}

// src/server/routes/agent.ts
import { Hono } from "hono";
import { streamSSE as streamSSE3 } from "hono/streaming";

// src/core/providers/claude-code.ts
import { spawn as spawn2, execSync } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path2 from "path";
var SHELL = process.env.SHELL || "/bin/zsh";
function resolveClaudePath(cwd) {
  const cached = path2.join(cwd, ".sna/claude-path");
  if (fs.existsSync(cached)) {
    const p = fs.readFileSync(cached, "utf8").trim();
    if (p) {
      try {
        execSync(`test -x "${p}"`, { stdio: "pipe" });
        return p;
      } catch {
      }
    }
  }
  for (const p of [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`
  ]) {
    try {
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return p;
    } catch {
    }
  }
  try {
    return execSync(`${SHELL} -l -c "which claude"`, { encoding: "utf8" }).trim();
  } catch {
    return "claude";
  }
}
var ClaudeCodeProcess = class {
  constructor(proc, options) {
    this.emitter = new EventEmitter();
    this._alive = true;
    this._sessionId = null;
    this.buffer = "";
    this.proc = proc;
    proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        console.log(`[agent:stdout] ${line.slice(0, 200)}`);
        try {
          const msg = JSON.parse(line);
          if (msg.session_id && !this._sessionId) {
            this._sessionId = msg.session_id;
          }
          const event = this.normalizeEvent(msg);
          if (event) this.emitter.emit("event", event);
        } catch {
        }
      }
    });
    proc.stderr.on("data", () => {
    });
    proc.on("exit", (code) => {
      this._alive = false;
      if (this.buffer.trim()) {
        try {
          const msg = JSON.parse(this.buffer);
          const event = this.normalizeEvent(msg);
          if (event) this.emitter.emit("event", event);
        } catch {
        }
      }
      this.emitter.emit("exit", code);
      console.log(`[agent] process exited (code=${code})`);
    });
    proc.on("error", (err) => {
      this._alive = false;
      this.emitter.emit("error", err);
    });
    if (options.prompt) {
      this.send(options.prompt);
    }
  }
  get alive() {
    return this._alive;
  }
  get sessionId() {
    return this._sessionId;
  }
  /**
   * Send a user message to the persistent Claude process via stdin.
   */
  send(input) {
    if (!this._alive || !this.proc.stdin.writable) return;
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: input }
    });
    console.log(`[agent:stdin] ${msg.slice(0, 200)}`);
    this.proc.stdin.write(msg + "\n");
  }
  kill() {
    if (this._alive) {
      this._alive = false;
      this.proc.kill("SIGTERM");
    }
  }
  on(event, handler) {
    this.emitter.on(event, handler);
  }
  off(event, handler) {
    this.emitter.off(event, handler);
  }
  normalizeEvent(msg) {
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") {
          return {
            type: "init",
            message: `Agent ready (${msg.model ?? "unknown"})`,
            data: { sessionId: msg.session_id, model: msg.model },
            timestamp: Date.now()
          };
        }
        return null;
      }
      case "assistant": {
        const content = msg.message?.content;
        if (!Array.isArray(content)) return null;
        const events = [];
        for (const block of content) {
          if (block.type === "tool_use") {
            events.push({
              type: "tool_use",
              message: block.name,
              data: { toolName: block.name, input: block.input, id: block.id },
              timestamp: Date.now()
            });
          }
        }
        const text = content.filter((c) => c.type === "text").map((c) => c.text).join("").trim();
        if (text) {
          events.push({ type: "assistant", message: text, timestamp: Date.now() });
        }
        if (events.length > 0) {
          for (let i = 1; i < events.length; i++) {
            this.emitter.emit("event", events[i]);
          }
          return events[0];
        }
        return null;
      }
      case "result": {
        if (msg.subtype === "success") {
          return {
            type: "complete",
            message: msg.result ?? "Done",
            data: { durationMs: msg.duration_ms, costUsd: msg.total_cost_usd },
            timestamp: Date.now()
          };
        }
        if (msg.subtype === "error" || msg.is_error) {
          return {
            type: "error",
            message: msg.result ?? msg.error ?? "Unknown error",
            timestamp: Date.now()
          };
        }
        return null;
      }
      case "rate_limit_event":
        return null;
      default:
        console.log(`[agent] unhandled event type: ${msg.type}`, JSON.stringify(msg).substring(0, 200));
        return null;
    }
  }
};
var ClaudeCodeProvider = class {
  constructor() {
    this.name = "claude-code";
  }
  async isAvailable() {
    try {
      const p = resolveClaudePath(process.cwd());
      execSync(`test -x "${p}"`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
  spawn(options) {
    const claudePath = resolveClaudePath(options.cwd);
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose"
    ];
    if (options.permissionMode) {
      args.push("--permission-mode", options.permissionMode);
    }
    const cleanEnv = { ...process.env, ...options.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    delete cleanEnv.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
    const proc = spawn2(claudePath, args, {
      cwd: options.cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    console.log(`[agent] spawned claude-code (pid=${proc.pid})`);
    return new ClaudeCodeProcess(proc, options);
  }
};

// src/core/providers/codex.ts
var CodexProvider = class {
  constructor() {
    this.name = "codex";
  }
  async isAvailable() {
    return false;
  }
  spawn(_options) {
    throw new Error("Codex provider not yet implemented");
  }
};

// src/core/providers/index.ts
var providers = {
  "claude-code": new ClaudeCodeProvider(),
  "codex": new CodexProvider()
};
function getProvider(name = "claude-code") {
  const provider2 = providers[name];
  if (!provider2) throw new Error(`Unknown agent provider: ${name}`);
  return provider2;
}

// src/server/routes/agent.ts
var currentProcess = null;
var eventBuffer = [];
var eventCounter = 0;
function setAgentProcess(proc) {
  currentProcess = proc;
  subscribeEvents(proc);
}
function subscribeEvents(proc) {
  proc.on("event", (e) => {
    eventBuffer.push(e);
    eventCounter++;
    if (eventBuffer.length > 500) {
      eventBuffer.splice(0, eventBuffer.length - 500);
    }
  });
}
function createAgentRoutes() {
  const app = new Hono();
  app.post("/start", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (currentProcess?.alive && !body.force) {
      return c.json({
        status: "already_running",
        provider: "claude-code",
        sessionId: currentProcess.sessionId
      });
    }
    if (currentProcess?.alive) {
      currentProcess.kill();
    }
    eventBuffer.length = 0;
    eventCounter = 0;
    const provider2 = getProvider(body.provider ?? "claude-code");
    try {
      currentProcess = provider2.spawn({
        cwd: process.cwd(),
        prompt: body.prompt,
        permissionMode: body.permissionMode ?? "acceptEdits"
      });
      subscribeEvents(currentProcess);
      return c.json({
        status: "started",
        provider: provider2.name
      });
    } catch (err) {
      return c.json({ status: "error", message: err.message }, 500);
    }
  });
  app.post("/send", async (c) => {
    if (!currentProcess?.alive) {
      return c.json(
        {
          status: "error",
          message: "No active agent session. Call POST /start first."
        },
        400
      );
    }
    const body = await c.req.json().catch(() => ({}));
    console.log(body);
    if (!body.message) {
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    currentProcess.send(body.message);
    return c.json({ status: "sent" });
  });
  app.get("/events", (c) => {
    const sinceParam = c.req.query("since");
    let cursor = sinceParam ? parseInt(sinceParam, 10) : eventCounter;
    return streamSSE3(c, async (stream) => {
      const POLL_MS = 300;
      const KEEPALIVE_MS = 15e3;
      let lastSend = Date.now();
      while (true) {
        if (cursor < eventCounter) {
          const startIdx = Math.max(
            0,
            eventBuffer.length - (eventCounter - cursor)
          );
          const newEvents = eventBuffer.slice(startIdx);
          for (const event of newEvents) {
            cursor++;
            await stream.writeSSE({
              id: String(cursor),
              data: JSON.stringify(event)
            });
            lastSend = Date.now();
          }
        }
        if (Date.now() - lastSend > KEEPALIVE_MS) {
          await stream.writeSSE({ data: "" });
          lastSend = Date.now();
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    });
  });
  app.post("/kill", async (c) => {
    if (currentProcess?.alive) {
      currentProcess.kill();
      return c.json({ status: "killed" });
    }
    return c.json({ status: "no_session" });
  });
  app.get("/status", (c) => {
    return c.json({
      alive: currentProcess?.alive ?? false,
      sessionId: currentProcess?.sessionId ?? null,
      eventCount: eventCounter
    });
  });
  return app;
}

// src/server/index.ts
function createSnaApp(options = {}) {
  const app = new Hono2();
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));
  app.get("/events", eventsRoute);
  app.post("/emit", emitRoute);
  app.route("/agent", createAgentRoutes());
  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }
  return app;
}

// src/server/standalone.ts
var port = parseInt(process.env.SNA_PORT ?? "3099", 10);
var permissionMode = process.env.SNA_PERMISSION_MODE ?? "acceptEdits";
var root = new Hono3();
root.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));
root.route("/", createSnaApp());
var provider = getProvider("claude-code");
console.log("[sna] spawning agent...");
var agentProcess = provider.spawn({ cwd: process.cwd(), permissionMode });
setAgentProcess(agentProcess);
var server = null;
function shutdown(signal) {
  console.log(`[sna] ${signal} \u2014 shutting down`);
  console.log("[sna] stopping Claude Code agent...");
  agentProcess.kill();
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
console.log(`[sna] listening on http://localhost:${port}`);
server = serve({ fetch: root.fetch, port }, () => {
  console.log(`[sna] API server ready \u2192 http://localhost:${port}`);
});
agentProcess.on("event", (e) => {
  if (e.type === "init") {
    console.log(`[sna] agent ready (session=${e.data?.sessionId ?? "?"})`);
  }
});
