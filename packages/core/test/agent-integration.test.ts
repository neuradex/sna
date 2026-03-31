/**
 * Agent integration tests — real Claude Code + mock Anthropic API server.
 *
 * Sets ANTHROPIC_BASE_URL → mock server, ANTHROPIC_API_KEY → fake key.
 * Tests full pipeline: WS → SessionManager → Provider → Claude Code → mock API → events → WS.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { WebSocket } from "ws";
import http from "http";
import { startMockAnthropicServer, type MockServer } from "./mock-anthropic-server.js";

const TEST_DB_DIR = path.join(import.meta.dirname, "../.test-data-agent");

let CLAUDE_AVAILABLE = false;
try { execSync("which claude", { stdio: "pipe" }); CLAUDE_AVAILABLE = true; } catch {}

function setup() {
  if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DB_DIR, "data"), { recursive: true });
  fs.mkdirSync(path.join(TEST_DB_DIR, ".sna"), { recursive: true });
  const origCwd = process.cwd;
  process.cwd = () => TEST_DB_DIR;
  return () => { process.cwd = origCwd; fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); };
}

interface Ctx {
  ws: WebSocket;
  server: http.Server;
  mockApi: MockServer;
  cleanup: () => void;
  origEnv: Record<string, string | undefined>;
  rid: number;
}

async function startAll(): Promise<Ctx> {
  const cleanup = setup();
  const mockApi = await startMockAnthropicServer();

  const origEnv = {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${mockApi.port}`;
  process.env.ANTHROPIC_API_KEY = "sk-test-mock-12345";

  const { createSnaApp, SessionManager, attachWebSocket } = await import("../src/server/index.js");
  const { serve } = await import("@hono/node-server");

  const sm = new SessionManager();
  const app = createSnaApp({ sessionManager: sm });

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

function reply(ctx: Ctx, rid: string) { return waitFor(ctx.ws, m => m.rid === rid); }
function push(ctx: Ctx, type: string) { return waitFor(ctx.ws, m => m.type === type && !m.rid); }
function event(ctx: Ctx, et: string) { return waitFor(ctx.ws, m => m.type === "agent.event" && m.event?.type === et); }

describe("Agent Integration (real CC + mock API)", { skip: !CLAUDE_AVAILABLE ? "claude not installed" : undefined }, () => {
  let ctx: Ctx;

  beforeEach(async () => { ctx = await startAll(); });
  afterEach(async () => {
    // Kill any leftover sessions
    try { send(ctx, "agent.kill"); } catch {}
    await new Promise(r => setTimeout(r, 500));
    ctx.ws.close();
    ctx.server.close();
    ctx.mockApi.close();
    // Restore env
    for (const [k, v] of Object.entries(ctx.origEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    ctx.cleanup();
  });

  async function startAgent(sid: string) {
    const startRid = send(ctx, "agent.start", {
      session: sid,
      permissionMode: "bypassPermissions",
      model: "test-mock",
    });
    const msg = await reply(ctx, startRid);
    assert.equal(msg.status, "started");
    return msg;
  }

  it("start → init event with ccSessionId", async () => {
    const createRid = send(ctx, "sessions.create", { label: "E2E-Init", cwd: TEST_DB_DIR });
    const created = await reply(ctx, createRid);
    const sid = created.sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await reply(ctx, ctx.rid.toString());

    await startAgent(sid);

    const init = await event(ctx, "init");
    assert.ok(init.event.data.sessionId, "init should have ccSessionId");

    // Verify ccSessionId in status
    await new Promise(r => setTimeout(r, 200));
    const statusRid = send(ctx, "agent.status", { session: sid });
    const status = await reply(ctx, statusRid);
    assert.ok(status.ccSessionId);
  });

  it("send → assistant + complete events", async () => {
    const createRid = send(ctx, "sessions.create", { label: "E2E-Send", cwd: TEST_DB_DIR });
    const created = await reply(ctx, createRid);
    const sid = created.sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await reply(ctx, ctx.rid.toString());
    await startAgent(sid);
    await event(ctx, "init");

    send(ctx, "agent.send", { session: sid, message: "Hello mock" });

    const asst = await event(ctx, "assistant");
    assert.ok(asst.event.message.includes("Mock reply"), "should get mock response");

    const complete = await event(ctx, "complete");
    assert.ok(complete.event.data.costUsd !== undefined);

    assert.ok(ctx.mockApi.requests.length >= 1, "mock server should have received requests");
  });

  it("kill → lifecycle events", async () => {
    const createRid = send(ctx, "sessions.create", { label: "E2E-Kill", cwd: TEST_DB_DIR });
    const created = await reply(ctx, createRid);
    const sid = created.sessionId;

    await startAgent(sid);
    const started = await push(ctx, "session.lifecycle");
    assert.equal(started.state, "started");

    const killRid = send(ctx, "agent.kill", { session: sid });
    const killMsg = await reply(ctx, killRid);
    assert.equal(killMsg.status, "killed");

    const killed = await push(ctx, "session.lifecycle");
    assert.equal(killed.state, "killed");
  });

  it("messages persisted to DB", async () => {
    const createRid = send(ctx, "sessions.create", { label: "E2E-DB", cwd: TEST_DB_DIR });
    const created = await reply(ctx, createRid);
    const sid = created.sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await reply(ctx, ctx.rid.toString());
    await startAgent(sid);
    await event(ctx, "init");

    send(ctx, "agent.send", { session: sid, message: "Persist me" });
    await event(ctx, "complete");
    await new Promise(r => setTimeout(r, 300));

    const listRid = send(ctx, "chat.messages.list", { session: sid });
    const listed = await reply(ctx, listRid);

    const users = listed.messages.filter((m: any) => m.role === "user");
    const assts = listed.messages.filter((m: any) => m.role === "assistant");
    assert.ok(users.length >= 1, "user message persisted");
    assert.ok(assts.length >= 1, "assistant message persisted");
  });

  it("config persisted after start", async () => {
    const createRid = send(ctx, "sessions.create", { label: "E2E-Config", cwd: TEST_DB_DIR });
    const created = await reply(ctx, createRid);
    const sid = created.sessionId;

    await startAgent(sid);
    await push(ctx, "session.lifecycle"); // started

    const listRid = send(ctx, "sessions.list");
    const listed = await reply(ctx, listRid);
    const s = listed.sessions.find((s: any) => s.id === sid);
    assert.ok(s.config);
    assert.equal(s.config.model, "test-mock");
    assert.equal(s.config.permissionMode, "bypassPermissions");
  });

  it("interrupt → interrupted event", async () => {
    const createRid = send(ctx, "sessions.create", { label: "E2E-Int", cwd: TEST_DB_DIR });
    const created = await reply(ctx, createRid);
    const sid = created.sessionId;

    send(ctx, "agent.subscribe", { session: sid });
    await reply(ctx, ctx.rid.toString());
    await startAgent(sid);
    await event(ctx, "init");

    // Send then immediately interrupt
    send(ctx, "agent.send", { session: sid, message: "Write a long essay" });
    await new Promise(r => setTimeout(r, 300));

    const intRid = send(ctx, "agent.interrupt", { session: sid });
    const intMsg = await reply(ctx, intRid);
    assert.equal(intMsg.status, "interrupted");

    // Should get interrupted or complete
    const ev = await waitFor(ctx.ws, m =>
      m.type === "agent.event" && (m.event?.type === "interrupted" || m.event?.type === "complete")
    );
    assert.ok(["interrupted", "complete"].includes(ev.event.type));
  });
});
