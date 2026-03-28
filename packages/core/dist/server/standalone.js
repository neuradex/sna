// src/server/standalone.ts
import { serve } from "@hono/node-server";
import { Hono as Hono4 } from "hono";
import { cors } from "hono/cors";
import chalk2 from "chalk";

// src/server/index.ts
import { Hono as Hono3 } from "hono";

// src/server/routes/events.ts
import { streamSSE } from "hono/streaming";

// src/db/schema.ts
import { createRequire } from "module";
import path from "path";
var require2 = createRequire(path.join(process.cwd(), "node_modules", "_"));
var BetterSqlite3 = require2("better-sqlite3");
var DB_PATH = path.join(process.cwd(), "data/sna.db");
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
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Ensure default session always exists
    INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES ('default', 'Chat', 'main');

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      skill_name TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

    CREATE TABLE IF NOT EXISTS skill_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      skill      TEXT NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      data       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill);
    CREATE INDEX IF NOT EXISTS idx_skill_events_created ON skill_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_events_session ON skill_events(session_id);
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
        child.on("error", async (err2) => {
          await stream.writeSSE({ data: `Error: ${err2.message}` });
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
import fs2 from "fs";
import path3 from "path";

// src/lib/logger.ts
import chalk from "chalk";
import fs from "fs";
import path2 from "path";
var LOG_PATH = path2.join(process.cwd(), ".dev.log");
try {
  fs.writeFileSync(LOG_PATH, "");
} catch {
}
function tsPlain() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function tsColored() {
  return chalk.gray(tsPlain());
}
var tags = {
  sna: chalk.bold.magenta(" SNA "),
  req: chalk.bold.blue(" REQ "),
  agent: chalk.bold.cyan(" AGT "),
  stdin: chalk.bold.green(" IN  "),
  stdout: chalk.bold.yellow(" OUT "),
  route: chalk.bold.blue(" API "),
  err: chalk.bold.red(" ERR ")
};
var tagPlain = {
  sna: " SNA ",
  req: " REQ ",
  agent: " AGT ",
  stdin: " IN  ",
  stdout: " OUT ",
  route: " API ",
  err: " ERR "
};
function appendFile(tag, args) {
  const line = `${tsPlain()} ${tag} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}
`;
  fs.appendFile(LOG_PATH, line, () => {
  });
}
function log(tag, ...args) {
  console.log(`${tsColored()} ${tags[tag]}`, ...args);
  appendFile(tagPlain[tag], args);
}
function err(tag, ...args) {
  console.error(`${tsColored()} ${tags[tag]}`, ...args);
  appendFile(tagPlain[tag], args);
}
var logger = { log, err };

// src/core/providers/claude-code.ts
var SHELL = process.env.SHELL || "/bin/zsh";
function resolveClaudePath(cwd) {
  const cached = path3.join(cwd, ".sna/claude-path");
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
        logger.log("stdout", line);
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
      logger.log("agent", `process exited (code=${code})`);
    });
    proc.on("error", (err2) => {
      this._alive = false;
      this.emitter.emit("error", err2);
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
    logger.log("stdin", msg.slice(0, 200));
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
          if (block.type === "thinking") {
            events.push({
              type: "thinking",
              message: block.thinking ?? "",
              timestamp: Date.now()
            });
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool_use",
              message: block.name,
              data: { toolName: block.name, input: block.input, id: block.id },
              timestamp: Date.now()
            });
          } else if (block.type === "text") {
            const text = (block.text ?? "").trim();
            if (text) {
              events.push({ type: "assistant", message: text, timestamp: Date.now() });
            }
          }
        }
        if (events.length > 0) {
          for (let i = 1; i < events.length; i++) {
            this.emitter.emit("event", events[i]);
          }
          return events[0];
        }
        return null;
      }
      case "user": {
        const userContent = msg.message?.content;
        if (!Array.isArray(userContent)) return null;
        for (const block of userContent) {
          if (block.type === "tool_result") {
            return {
              type: "tool_result",
              message: typeof block.content === "string" ? block.content.slice(0, 300) : JSON.stringify(block.content).slice(0, 300),
              data: { toolUseId: block.tool_use_id, isError: block.is_error },
              timestamp: Date.now()
            };
          }
        }
        return null;
      }
      case "result": {
        if (msg.subtype === "success") {
          const perTurn = msg.usage ?? {};
          const mu = msg.modelUsage ?? {};
          const modelKey = Object.keys(mu)[0] ?? "";
          const cumulative = mu[modelKey] ?? {};
          return {
            type: "complete",
            message: msg.result ?? "Done",
            data: {
              durationMs: msg.duration_ms,
              // Per-turn values (for individual message cost labels)
              turnCostUsd: msg.total_cost_usd,
              turnOutputTokens: perTurn.output_tokens ?? 0,
              // Session-cumulative values (for context window header)
              totalInputTokens: cumulative.inputTokens ?? 0,
              totalOutputTokens: cumulative.outputTokens ?? 0,
              totalCacheRead: cumulative.cacheReadInputTokens ?? 0,
              totalCacheWrite: cumulative.cacheCreationInputTokens ?? 0,
              totalCostUsd: cumulative.costUSD ?? 0,
              contextWindow: cumulative.contextWindow ?? 0,
              model: modelKey
            },
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
        logger.log("agent", `unhandled event: ${msg.type}`, JSON.stringify(msg).substring(0, 200));
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
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose"
    ];
    if (options.model) {
      args.push("--model", options.model);
    }
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
    logger.log("agent", `spawned claude-code (pid=${proc.pid})`);
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
function getSessionId(c) {
  return c.req.query("session") ?? "default";
}
function createAgentRoutes(sessionManager2) {
  const app = new Hono();
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const session = sessionManager2.createSession({
        label: body.label,
        cwd: body.cwd
      });
      logger.log("route", `POST /sessions \u2192 created "${session.id}"`);
      return c.json({ status: "created", sessionId: session.id, label: session.label });
    } catch (e) {
      logger.err("err", `POST /sessions \u2192 ${e.message}`);
      return c.json({ status: "error", message: e.message }, 409);
    }
  });
  app.get("/sessions", (c) => {
    return c.json({ sessions: sessionManager2.listSessions() });
  });
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot remove default session" }, 400);
    }
    const removed = sessionManager2.removeSession(id);
    if (!removed) {
      return c.json({ status: "error", message: "Session not found" }, 404);
    }
    logger.log("route", `DELETE /sessions/${id} \u2192 removed`);
    return c.json({ status: "removed" });
  });
  app.post("/start", async (c) => {
    const sessionId = getSessionId(c);
    const body = await c.req.json().catch(() => ({}));
    const session = sessionManager2.getOrCreateSession(sessionId);
    if (session.process?.alive && !body.force) {
      logger.log("route", `POST /start?session=${sessionId} \u2192 already_running`);
      return c.json({
        status: "already_running",
        provider: "claude-code",
        sessionId: session.process.sessionId
      });
    }
    if (session.process?.alive) {
      session.process.kill();
    }
    session.eventBuffer.length = 0;
    const provider2 = getProvider(body.provider ?? "claude-code");
    const skillMatch = body.prompt?.match(/^Execute the skill:\s*(\S+)/);
    if (skillMatch) {
      try {
        const db = getDb();
        db.prepare(
          `INSERT INTO skill_events (session_id, skill, type, message) VALUES (?, ?, 'invoked', ?)`
        ).run(sessionId, skillMatch[1], `Skill ${skillMatch[1]} invoked`);
      } catch {
      }
    }
    try {
      const proc = provider2.spawn({
        cwd: session.cwd,
        prompt: body.prompt,
        model: body.model ?? "claude-sonnet-4-6",
        permissionMode: body.permissionMode ?? "acceptEdits",
        env: { SNA_SESSION_ID: sessionId }
      });
      sessionManager2.setProcess(sessionId, proc);
      logger.log("route", `POST /start?session=${sessionId} \u2192 started`);
      return c.json({
        status: "started",
        provider: provider2.name,
        sessionId: session.id
      });
    } catch (e) {
      logger.err("err", `POST /start?session=${sessionId} failed: ${e.message}`);
      return c.json({ status: "error", message: e.message }, 500);
    }
  });
  app.post("/send", async (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager2.getSession(sessionId);
    if (!session?.process?.alive) {
      logger.err("err", `POST /send?session=${sessionId} \u2192 no active session`);
      return c.json(
        { status: "error", message: `No active agent session "${sessionId}". Call POST /start first.` },
        400
      );
    }
    const body = await c.req.json().catch(() => ({}));
    if (!body.message) {
      logger.err("err", `POST /send?session=${sessionId} \u2192 empty message`);
      return c.json({ status: "error", message: "message is required" }, 400);
    }
    sessionManager2.touch(sessionId);
    logger.log("route", `POST /send?session=${sessionId} \u2192 "${body.message.slice(0, 80)}"`);
    session.process.send(body.message);
    return c.json({ status: "sent" });
  });
  app.get("/events", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager2.getOrCreateSession(sessionId);
    const sinceParam = c.req.query("since");
    let cursor = sinceParam ? parseInt(sinceParam, 10) : session.eventCounter;
    return streamSSE3(c, async (stream) => {
      const POLL_MS = 300;
      const KEEPALIVE_MS = 15e3;
      let lastSend = Date.now();
      while (true) {
        if (cursor < session.eventCounter) {
          const startIdx = Math.max(
            0,
            session.eventBuffer.length - (session.eventCounter - cursor)
          );
          const newEvents = session.eventBuffer.slice(startIdx);
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
    const sessionId = getSessionId(c);
    const killed = sessionManager2.killSession(sessionId);
    return c.json({ status: killed ? "killed" : "no_session" });
  });
  app.get("/status", (c) => {
    const sessionId = getSessionId(c);
    const session = sessionManager2.getSession(sessionId);
    return c.json({
      alive: session?.process?.alive ?? false,
      sessionId: session?.process?.sessionId ?? null,
      eventCount: session?.eventCounter ?? 0
    });
  });
  return app;
}

// src/server/routes/chat.ts
import { Hono as Hono2 } from "hono";
function createChatRoutes() {
  const app = new Hono2();
  app.get("/sessions", (c) => {
    const db = getDb();
    const sessions = db.prepare(
      `SELECT id, label, type, created_at FROM chat_sessions ORDER BY created_at DESC`
    ).all();
    return c.json({ sessions });
  });
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = body.id ?? crypto.randomUUID().slice(0, 8);
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, ?)`
    ).run(id, body.label ?? id, body.type ?? "background");
    return c.json({ status: "created", id });
  });
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot delete default session" }, 400);
    }
    const db = getDb();
    db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
    return c.json({ status: "deleted" });
  });
  app.get("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const sinceParam = c.req.query("since");
    const db = getDb();
    const query = sinceParam ? db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`) : db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`);
    const messages = sinceParam ? query.all(id, parseInt(sinceParam, 10)) : query.all(id);
    return c.json({ messages });
  });
  app.post("/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    if (!body.role) {
      return c.json({ status: "error", message: "role is required" }, 400);
    }
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, sessionId);
    const result = db.prepare(
      `INSERT INTO chat_messages (session_id, role, content, skill_name, meta) VALUES (?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      body.role,
      body.content ?? "",
      body.skill_name ?? null,
      body.meta ? JSON.stringify(body.meta) : null
    );
    return c.json({ status: "created", id: result.lastInsertRowid });
  });
  app.delete("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const db = getDb();
    db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
    return c.json({ status: "cleared" });
  });
  return app;
}

// src/server/session-manager.ts
var DEFAULT_MAX_SESSIONS = 5;
var MAX_EVENT_BUFFER = 500;
var SessionManager = class {
  constructor(options = {}) {
    this.sessions = /* @__PURE__ */ new Map();
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }
  /** Create a new session. Throws if max sessions reached. */
  createSession(opts = {}) {
    const id = opts.id ?? crypto.randomUUID().slice(0, 8);
    if (this.sessions.has(id)) {
      return this.sessions.get(id);
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Max sessions (${this.maxSessions}) reached`);
    }
    const session = {
      id,
      process: null,
      eventBuffer: [],
      eventCounter: 0,
      label: opts.label ?? id,
      cwd: opts.cwd ?? process.cwd(),
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };
    this.sessions.set(id, session);
    return session;
  }
  /** Get a session by ID. */
  getSession(id) {
    return this.sessions.get(id);
  }
  /** Get or create a session (used for "default" backward compat). */
  getOrCreateSession(id, opts) {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    return this.createSession({ id, ...opts });
  }
  /** Set the agent process for a session. Subscribes to events. */
  setProcess(sessionId, proc) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    session.process = proc;
    session.lastActivityAt = Date.now();
    proc.on("event", (e) => {
      session.eventBuffer.push(e);
      session.eventCounter++;
      if (session.eventBuffer.length > MAX_EVENT_BUFFER) {
        session.eventBuffer.splice(0, session.eventBuffer.length - MAX_EVENT_BUFFER);
      }
    });
  }
  /** Kill the agent process in a session (session stays, can be restarted). */
  killSession(id) {
    const session = this.sessions.get(id);
    if (!session?.process?.alive) return false;
    session.process.kill();
    return true;
  }
  /** Remove a session entirely. Cannot remove "default". */
  removeSession(id) {
    if (id === "default") return false;
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.process?.alive) session.process.kill();
    this.sessions.delete(id);
    return true;
  }
  /** List all sessions as serializable info objects. */
  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      label: s.label,
      alive: s.process?.alive ?? false,
      cwd: s.cwd,
      eventCount: s.eventCounter,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt
    }));
  }
  /** Touch a session's lastActivityAt timestamp. */
  touch(id) {
    const session = this.sessions.get(id);
    if (session) session.lastActivityAt = Date.now();
  }
  /** Kill all sessions. Used during shutdown. */
  killAll() {
    for (const session of this.sessions.values()) {
      if (session.process?.alive) {
        session.process.kill();
      }
    }
  }
  get size() {
    return this.sessions.size;
  }
};

// src/server/index.ts
function createSnaApp(options = {}) {
  const sessionManager2 = options.sessionManager ?? new SessionManager();
  const app = new Hono3();
  app.get("/health", (c) => c.json({ ok: true, name: "sna", version: "1" }));
  app.get("/events", eventsRoute);
  app.post("/emit", emitRoute);
  app.route("/agent", createAgentRoutes(sessionManager2));
  app.route("/chat", createChatRoutes());
  if (options.runCommands) {
    app.get("/run", createRunRoute(options.runCommands));
  }
  return app;
}

// src/server/standalone.ts
var port = parseInt(process.env.SNA_PORT ?? "3099", 10);
var permissionMode = process.env.SNA_PERMISSION_MODE ?? "acceptEdits";
var defaultModel = process.env.SNA_MODEL ?? "claude-sonnet-4-6";
var maxSessions = parseInt(process.env.SNA_MAX_SESSIONS ?? "5", 10);
var root = new Hono4();
root.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));
var methodColor = {
  GET: chalk2.green,
  POST: chalk2.yellow,
  DELETE: chalk2.red,
  OPTIONS: chalk2.gray
};
root.use("*", async (c, next) => {
  const m = c.req.method;
  const colorFn = methodColor[m] ?? chalk2.white;
  const path4 = new URL(c.req.url).pathname;
  logger.log("req", `${colorFn(m.padEnd(6))} ${path4}`);
  await next();
});
var sessionManager = new SessionManager({ maxSessions });
sessionManager.createSession({ id: "default", cwd: process.cwd() });
var provider = getProvider("claude-code");
logger.log("sna", "spawning agent...");
var agentProcess = provider.spawn({ cwd: process.cwd(), permissionMode, model: defaultModel });
sessionManager.setProcess("default", agentProcess);
root.route("/", createSnaApp({ sessionManager }));
var server = null;
var shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  logger.log("sna", chalk2.dim("stopping all sessions..."));
  sessionManager.killAll();
  if (server) {
    server.close(() => {
      logger.log("sna", chalk2.green("clean shutdown") + chalk2.dim(" \u2014 see you next time"));
      console.log("");
      process.exit(0);
    });
  }
  setTimeout(() => {
    logger.log("sna", chalk2.green("shutdown complete"));
    console.log("");
    process.exit(0);
  }, 3e3).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err2) => {
  if (shuttingDown) process.exit(0);
  console.error(err2);
  process.exit(1);
});
server = serve({ fetch: root.fetch, port }, () => {
  console.log("");
  logger.log("sna", chalk2.green.bold(`API server ready \u2192 http://localhost:${port}`));
  console.log("");
});
agentProcess.on("event", (e) => {
  if (e.type === "init") {
    logger.log("agent", chalk2.green(`agent ready (session=${e.data?.sessionId ?? "?"})`));
  }
});
