/**
 * Agent integration tests — real Claude Code + mock Anthropic API.
 *
 * Uses startMockAnthropicServer() from src/testing/mock-api.ts.
 * Sets ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY before spawning.
 *
 * Tests full pipeline: WS → SessionManager → Provider → Claude Code → mock API → events → WS
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { WebSocket } from "ws";
import http from "http";
import { startMockAnthropicServer, type MockServer } from "../src/testing/mock-api.js";

const TEST_DB_DIR = path.join(import.meta.dirname, "../.test-data-agent");

let CLAUDE_AVAILABLE = false;
try { execSync("which claude", { stdio: "pipe" }); CLAUDE_AVAILABLE = true; } catch {}

interface Ctx {
  ws: WebSocket;
  server: http.Server;
  mockApi: MockServer;
  cleanup: () => void;
  origEnv: Record<string, string | undefined>;
  rid: number;
}

async function startAll(): Promise<Ctx> {
  // Clean test dir
  if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DB_DIR, "data"), { recursive: true });
  fs.mkdirSync(path.join(TEST_DB_DIR, ".sna"), { recursive: true });
  const origCwd = process.cwd;
  process.cwd = () => TEST_DB_DIR;

  // Start mock Anthropic API
  const mockApi = await startMockAnthropicServer();

  // Set env BEFORE imports so ClaudeCodeProvider inherits them via process.env spread
  // Clean env for Claude Code: only essentials + mock vars. No parent OAuth tokens.
  const mockConfigDir = path.join(TEST_DB_DIR, ".mock-claude-config");
  fs.mkdirSync(mockConfigDir, { recursive: true });

  const origEnv = {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  };
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${mockApi.port}`;
  process.env.ANTHROPIC_API_KEY = "sk-test-mock-integration";
  process.env.CLAUDE_CONFIG_DIR = mockConfigDir;

  // ClaudeCodeProvider uses ...process.env for child spawn, but we also
  // need to strip OAuth vars that might bleed from parent.
  // We delete them here; afterEach restores originals.
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN;

  const { createSnaApp, SessionManager, attachWebSocket } = await import("../src/server/index.js");
  const { serve } = await import("@hono/node-server");

  const sm = new SessionManager();
  const app = createSnaApp({ sessionManager: sm });

  const cleanup = () => {
    process.cwd = origCwd;
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  };

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, () => {
      const port = (server.address() as any)?.port;
      attachWebSocket(server, sm);
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on("open", () => resolve({ ws, server, mockApi, cleanup, origEnv, rid: 0 }));
    });
  });
}

function send(ctx: Ctx, type: string, data: Record<string, unknown> = {}): string {
  const rid = String(++ctx.rid);
  ctx.ws.send(JSON.stringify({ type, rid, ...data }));
  return rid;
}

function waitFor(ws: WebSocket, fn: (m: any) => boolean, ms = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout")), ms);
    const h = (raw: any) => {
      const m = JSON.parse(raw.toString());
      if (fn(m)) { clearTimeout(t); ws.off("message", h); resolve(m); }
    };
    ws.on("message", h);
  });
}

function waitReply(ctx: Ctx, rid: string) { return waitFor(ctx.ws, m => m.rid === rid); }
function waitPush(ctx: Ctx, type: string) { return waitFor(ctx.ws, m => m.type === type && !m.rid); }
function waitEvent(ctx: Ctx, et: string) { return waitFor(ctx.ws, m => m.type === "agent.event" && m.event?.type === et); }

async function startAgent(ctx: Ctx, sid: string) {
  const rid = send(ctx, "agent.start", {
    session: sid,
    permissionMode: "bypassPermissions",
    model: "test-mock",
  });
  const msg = await waitReply(ctx, rid);
  assert.equal(msg.status, "started");
}

describe("Agent Integration (real CC + mock API)", { skip: !CLAUDE_AVAILABLE ? "claude not installed" : undefined }, () => {
  let ctx: Ctx;

  beforeEach(async () => { ctx = await startAll(); });
  afterEach(async () => {
    try { send(ctx, "agent.kill"); } catch {}
    await new Promise(r => setTimeout(r, 300));
    ctx.ws.close();
    ctx.server.close();
    ctx.mockApi.close();
    ctx.cleanup();
  });

  it("start → init event with ccSessionId", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Init", cwd: TEST_DB_DIR });
    const created = await waitReply(ctx, createRid);
    const sid = created.sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await waitReply(ctx, ctx.rid.toString());

    await startAgent(ctx, sid);

    const init = await waitEvent(ctx, "init");
    assert.ok(init.event.data.sessionId, "init has CC session ID");

    await new Promise(r => setTimeout(r, 200));
    const statusRid = send(ctx, "agent.status", { session: sid });
    const status = await waitReply(ctx, statusRid);
    assert.ok(status.ccSessionId, "ccSessionId in status");
    assert.equal(status.alive, true);
  });

  it("send → assistant + complete", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Send", cwd: TEST_DB_DIR });
    const sid = (await waitReply(ctx, createRid)).sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await waitReply(ctx, ctx.rid.toString());
    await startAgent(ctx, sid);
    await waitEvent(ctx, "init");

    send(ctx, "agent.send", { session: sid, message: "Hello mock" });

    const asst = await waitEvent(ctx, "assistant");
    assert.ok(asst.event.message.includes("Mock reply"), "got mock response");

    const complete = await waitEvent(ctx, "complete");
    assert.ok(complete.event.data.costUsd !== undefined);
    assert.ok(ctx.mockApi.requests.length >= 1, "mock received request");
  });

  it("kill → lifecycle events + not alive", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Kill", cwd: TEST_DB_DIR });
    const sid = (await waitReply(ctx, createRid)).sessionId;

    await startAgent(ctx, sid);
    const started = await waitPush(ctx, "session.lifecycle");
    assert.equal(started.state, "started");

    const killRid = send(ctx, "agent.kill", { session: sid });
    assert.equal((await waitReply(ctx, killRid)).status, "killed");

    const killed = await waitPush(ctx, "session.lifecycle");
    assert.equal(killed.state, "killed");

    const statusRid = send(ctx, "agent.status", { session: sid });
    assert.equal((await waitReply(ctx, statusRid)).alive, false);
  });

  it("user + assistant messages persisted to DB", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Persist", cwd: TEST_DB_DIR });
    const sid = (await waitReply(ctx, createRid)).sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await waitReply(ctx, ctx.rid.toString());
    await startAgent(ctx, sid);
    await waitEvent(ctx, "init");

    send(ctx, "agent.send", { session: sid, message: "Persist me" });
    await waitEvent(ctx, "complete");
    await new Promise(r => setTimeout(r, 300));

    const listRid = send(ctx, "chat.messages.list", { session: sid });
    const listed = await waitReply(ctx, listRid);
    const users = listed.messages.filter((m: any) => m.role === "user");
    const assts = listed.messages.filter((m: any) => m.role === "assistant");
    assert.ok(users.length >= 1, "user message persisted");
    assert.ok(assts.length >= 1, "assistant message persisted");
  });

  it("config persisted after start", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Config", cwd: TEST_DB_DIR });
    const sid = (await waitReply(ctx, createRid)).sessionId;

    await startAgent(ctx, sid);
    await waitPush(ctx, "session.lifecycle");

    const listRid = send(ctx, "sessions.list");
    const s = (await waitReply(ctx, listRid)).sessions.find((s: any) => s.id === sid);
    assert.ok(s.config);
    assert.equal(s.config.model, "test-mock");
    assert.equal(s.config.permissionMode, "bypassPermissions");
  });

  it("interrupt → interrupted event", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Interrupt", cwd: TEST_DB_DIR });
    const sid = (await waitReply(ctx, createRid)).sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await waitReply(ctx, ctx.rid.toString());
    await startAgent(ctx, sid);
    await waitEvent(ctx, "init");

    send(ctx, "agent.send", { session: sid, message: "Write a long story" });
    await new Promise(r => setTimeout(r, 500));

    const intRid = send(ctx, "agent.interrupt", { session: sid });
    assert.equal((await waitReply(ctx, intRid)).status, "interrupted");

    const ev = await waitFor(ctx.ws, m =>
      m.type === "agent.event" && (m.event?.type === "interrupted" || m.event?.type === "complete")
    );
    assert.ok(["interrupted", "complete"].includes(ev.event.type));
  });
});
