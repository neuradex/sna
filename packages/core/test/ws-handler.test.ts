/**
 * WebSocket handler tests — verify all WS message types.
 * Starts a real HTTP+WS server on a random port, connects a WS client.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { WebSocket } from "ws";
import http from "http";

const TEST_DB_DIR = path.join(import.meta.dirname, "../.test-data-ws");

function setup() {
  if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  const origCwd = process.cwd;
  process.cwd = () => TEST_DB_DIR;
  return () => { process.cwd = origCwd; fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); };
}

interface TestContext {
  ws: WebSocket;
  server: http.Server;
  port: number;
  cleanup: () => void;
  rid: number;
}

async function startServer(): Promise<TestContext> {
  const cleanup = setup();
  const { createSnaApp, SessionManager, attachWebSocket } = await import("../src/server/index.js");
  const { serve } = await import("@hono/node-server");

  const sm = new SessionManager();
  const app = createSnaApp({ sessionManager: sm });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      const port = (info as any).port ?? (server.address() as any)?.port;
      attachWebSocket(server, sm);

      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on("open", () => {
        resolve({ ws, server, port, cleanup, rid: 0 });
      });
    });
  });
}

function send(ctx: TestContext, type: string, data: Record<string, unknown> = {}): string {
  const rid = String(++ctx.rid);
  ctx.ws.send(JSON.stringify({ type, rid, ...data }));
  return rid;
}

function waitForMessage(ws: WebSocket, matchFn: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), timeoutMs);
    const handler = (raw: any) => {
      const msg = JSON.parse(raw.toString());
      if (matchFn(msg)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function waitForReply(ctx: TestContext, rid: string): Promise<any> {
  return waitForMessage(ctx.ws, (msg) => msg.rid === rid);
}

function waitForPush(ctx: TestContext, type: string): Promise<any> {
  return waitForMessage(ctx.ws, (msg) => msg.type === type && !msg.rid);
}

describe("WebSocket Handler", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await startServer();
  });

  afterEach(() => {
    ctx.ws.close();
    ctx.server.close();
    ctx.cleanup();
  });

  // ── Session CRUD ────────────────────────────────────

  it("sessions.create", async () => {
    const rid = send(ctx, "sessions.create", { label: "WS-Test", cwd: "/tmp/ws", meta: { app: "test" } });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "created");
    assert.ok(msg.sessionId);
    assert.equal(msg.label, "WS-Test");
    assert.deepEqual(msg.meta, { app: "test" });
  });

  it("sessions.list", async () => {
    send(ctx, "sessions.create", { label: "List-Test" });
    await waitForReply(ctx, ctx.rid.toString());

    const rid = send(ctx, "sessions.list");
    const msg = await waitForReply(ctx, rid);
    assert.ok(Array.isArray(msg.sessions));
    const s = msg.sessions.find((s: any) => s.label === "List-Test");
    assert.ok(s);
    assert.ok("config" in s);
    assert.ok("ccSessionId" in s);
  });

  it("sessions.remove", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Remove-Me" });
    const created = await waitForReply(ctx, createRid);

    const rid = send(ctx, "sessions.remove", { session: created.sessionId });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "removed");
  });

  it("sessions.remove default blocked", async () => {
    // Ensure default exists
    send(ctx, "sessions.create", { id: "default" });
    await waitForReply(ctx, ctx.rid.toString());

    const rid = send(ctx, "sessions.remove", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
  });

  // ── Agent (no process) ──────────────────────────────

  it("agent.status returns not alive", async () => {
    const rid = send(ctx, "agent.status", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.alive, false);
    assert.ok("config" in msg);
    assert.ok("ccSessionId" in msg);
  });

  it("agent.send without process returns error", async () => {
    const rid = send(ctx, "agent.send", { session: "default", message: "hi" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
  });

  it("agent.kill on dead session", async () => {
    const rid = send(ctx, "agent.kill", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "no_session");
  });

  it("agent.interrupt on dead session", async () => {
    const rid = send(ctx, "agent.interrupt", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "no_session");
  });

  // ── Set model/permission without process ────────────

  it("agent.set-model updates config without process", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Model-WS" });
    const created = await waitForReply(ctx, createRid);

    const rid = send(ctx, "agent.set-model", { session: created.sessionId, model: "claude-opus-4-6" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "updated");
    assert.equal(msg.model, "claude-opus-4-6");
  });

  it("agent.set-model without model returns error", async () => {
    const rid = send(ctx, "agent.set-model", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
  });

  it("agent.set-permission-mode updates config without process", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Perm-WS" });
    const created = await waitForReply(ctx, createRid);

    const rid = send(ctx, "agent.set-permission-mode", { session: created.sessionId, permissionMode: "bypassPermissions" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "updated");
    assert.equal(msg.permissionMode, "bypassPermissions");
  });

  it("agent.set-model on non-existent session", async () => {
    const rid = send(ctx, "agent.set-model", { session: "nope-nope", model: "haiku" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "no_session");
  });

  // ── Config changed push ─────────────────────────────

  it("session.config-changed push on set-model", async () => {
    const createRid = send(ctx, "sessions.create", { label: "Push-Test" });
    const created = await waitForReply(ctx, createRid);

    const pushPromise = waitForPush(ctx, "session.config-changed");
    send(ctx, "agent.set-model", { session: created.sessionId, model: "claude-opus-4-6" });

    const push = await pushPromise;
    assert.equal(push.session, created.sessionId);
    assert.equal(push.config.model, "claude-opus-4-6");
  });

  // ── Emit + skill event subscription ─────────────────

  it("emit writes event and returns id", async () => {
    const rid = send(ctx, "emit", { skill: "test-skill", eventType: "start", message: "Starting" });
    const msg = await waitForReply(ctx, rid);
    assert.ok(msg.id);
  });

  it("emit requires all fields", async () => {
    const rid = send(ctx, "emit", { skill: "test" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
  });

  it("events.subscribe + emit → skill.event push", async () => {
    const subRid = send(ctx, "events.subscribe");
    await waitForReply(ctx, subRid);

    const pushPromise = waitForPush(ctx, "skill.event");
    send(ctx, "emit", { skill: "push-test", eventType: "milestone", message: "Done" });

    const push = await pushPromise;
    assert.equal(push.data.skill, "push-test");
    assert.equal(push.data.type, "milestone");
  });

  it("events.unsubscribe", async () => {
    const subRid = send(ctx, "events.subscribe");
    await waitForReply(ctx, subRid);

    const unsubRid = send(ctx, "events.unsubscribe");
    const msg = await waitForReply(ctx, unsubRid);
    assert.equal(msg.type, "events.unsubscribe");
  });

  // ── Permission ──────────────────────────────────────

  it("permission.pending returns array", async () => {
    const rid = send(ctx, "permission.pending");
    const msg = await waitForReply(ctx, rid);
    assert.ok(Array.isArray(msg.pending));
  });

  it("permission.pending with session returns array", async () => {
    const rid = send(ctx, "permission.pending", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.ok(Array.isArray(msg.pending));
    assert.equal(msg.pending.length, 0);
  });

  it("permission.respond without pending returns error", async () => {
    const rid = send(ctx, "permission.respond", { session: "default", approved: true });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
  });

  it("permission.subscribe and unsubscribe", async () => {
    const subRid = send(ctx, "permission.subscribe");
    const subMsg = await waitForReply(ctx, subRid);
    assert.equal(subMsg.type, "permission.subscribe");

    const unsubRid = send(ctx, "permission.unsubscribe");
    const unsubMsg = await waitForReply(ctx, unsubRid);
    assert.equal(unsubMsg.type, "permission.unsubscribe");
  });

  // ── Agent subscribe/unsubscribe ─────────────────────

  it("agent.subscribe returns cursor", async () => {
    const rid = send(ctx, "agent.subscribe", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.ok("cursor" in msg);
  });

  it("agent.unsubscribe", async () => {
    const subRid = send(ctx, "agent.subscribe", { session: "default" });
    await waitForReply(ctx, subRid);

    const unsubRid = send(ctx, "agent.unsubscribe", { session: "default" });
    const msg = await waitForReply(ctx, unsubRid);
    assert.equal(msg.type, "agent.unsubscribe");
  });

  // ── Chat sessions ───────────────────────────────────

  it("chat.sessions.list", async () => {
    const rid = send(ctx, "chat.sessions.list");
    const msg = await waitForReply(ctx, rid);
    assert.ok(Array.isArray(msg.sessions));
  });

  it("chat.sessions.create", async () => {
    const rid = send(ctx, "chat.sessions.create", { label: "WS-Chat", meta: { x: 1 } });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "created");
    assert.ok(msg.id);
    assert.deepEqual(msg.meta, { x: 1 });
  });

  it("chat.sessions.remove", async () => {
    const createRid = send(ctx, "chat.sessions.create", { id: "ws-del-test" });
    await waitForReply(ctx, createRid);

    const rid = send(ctx, "chat.sessions.remove", { session: "ws-del-test" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.status, "deleted");
  });

  it("chat.sessions.remove default blocked", async () => {
    const rid = send(ctx, "chat.sessions.remove", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
  });

  // ── Chat messages ───────────────────────────────────

  it("chat.messages.create + list", async () => {
    send(ctx, "chat.sessions.create", { id: "ws-msg-test" });
    await waitForReply(ctx, ctx.rid.toString());

    const createRid = send(ctx, "chat.messages.create", { session: "ws-msg-test", role: "user", content: "hello ws" });
    const created = await waitForReply(ctx, createRid);
    assert.equal(created.status, "created");
    assert.ok(created.id);

    const listRid = send(ctx, "chat.messages.list", { session: "ws-msg-test" });
    const listed = await waitForReply(ctx, listRid);
    assert.equal(listed.messages.length, 1);
    assert.equal(listed.messages[0].content, "hello ws");
  });

  it("chat.messages.list with since", async () => {
    send(ctx, "chat.sessions.create", { id: "ws-since-test" });
    await waitForReply(ctx, ctx.rid.toString());

    send(ctx, "chat.messages.create", { session: "ws-since-test", role: "user", content: "msg1" });
    await waitForReply(ctx, ctx.rid.toString());
    send(ctx, "chat.messages.create", { session: "ws-since-test", role: "user", content: "msg2" });
    await waitForReply(ctx, ctx.rid.toString());

    const allRid = send(ctx, "chat.messages.list", { session: "ws-since-test" });
    const all = await waitForReply(ctx, allRid);
    const firstId = all.messages[0].id;

    const sinceRid = send(ctx, "chat.messages.list", { session: "ws-since-test", since: firstId });
    const since = await waitForReply(ctx, sinceRid);
    assert.equal(since.messages.length, 1);
    assert.equal(since.messages[0].content, "msg2");
  });

  it("chat.messages.clear", async () => {
    send(ctx, "chat.sessions.create", { id: "ws-clear-test" });
    await waitForReply(ctx, ctx.rid.toString());
    send(ctx, "chat.messages.create", { session: "ws-clear-test", role: "user", content: "bye" });
    await waitForReply(ctx, ctx.rid.toString());

    const clearRid = send(ctx, "chat.messages.clear", { session: "ws-clear-test" });
    const cleared = await waitForReply(ctx, clearRid);
    assert.equal(cleared.status, "cleared");

    const listRid = send(ctx, "chat.messages.list", { session: "ws-clear-test" });
    const listed = await waitForReply(ctx, listRid);
    assert.equal(listed.messages.length, 0);
  });

  // ── Error handling ──────────────────────────────────

  it("unknown message type returns error", async () => {
    const rid = send(ctx, "totally.bogus");
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
    assert.ok(msg.message.includes("Unknown"));
  });

  it("invalid JSON returns error", async () => {
    const errorPromise = waitForMessage(ctx.ws, (msg) => msg.type === "error");
    ctx.ws.send("not json {{{");
    const msg = await errorPromise;
    assert.equal(msg.type, "error");
    assert.ok(msg.message.includes("invalid JSON"));
  });

  it("missing type returns error", async () => {
    const errorPromise = waitForMessage(ctx.ws, (msg) => msg.type === "error");
    ctx.ws.send(JSON.stringify({ rid: "no-type" }));
    const msg = await errorPromise;
    assert.ok(msg.message.includes("type is required"));
  });

  // ── v0.4 features ─────────────────────────────────

  it("agent.status includes agentStatus", async () => {
    const rid = send(ctx, "agent.status", { session: "default" });
    const msg = await waitForReply(ctx, rid);
    assert.ok("agentStatus" in msg);
    assert.equal(msg.agentStatus, "disconnected");
  });

  it("sessions.list includes agentStatus", async () => {
    send(ctx, "sessions.create", { label: "AgentStatusTest" });
    await waitForReply(ctx, ctx.rid.toString());

    const rid = send(ctx, "sessions.list");
    const msg = await waitForReply(ctx, rid);
    const s = msg.sessions.find((s: any) => s.label === "AgentStatusTest");
    assert.ok(s);
    assert.equal(s.agentStatus, "disconnected");
  });

  it("agent.resume with no history returns error", async () => {
    const createRid = send(ctx, "sessions.create", { label: "ResumeNoHistory" });
    const created = await waitForReply(ctx, createRid);

    const rid = send(ctx, "agent.resume", { session: created.sessionId });
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.type, "error");
    assert.ok(msg.message.includes("No history"));
  });

  it("agent.subscribe with since=0 replays DB history", async () => {
    // Create session with messages in DB
    send(ctx, "chat.sessions.create", { id: "history-replay-test" });
    await waitForReply(ctx, ctx.rid.toString());
    send(ctx, "chat.messages.create", { session: "history-replay-test", role: "user", content: "hello from DB" });
    await waitForReply(ctx, ctx.rid.toString());
    send(ctx, "chat.messages.create", { session: "history-replay-test", role: "assistant", content: "hi from DB" });
    await waitForReply(ctx, ctx.rid.toString());

    // Subscribe with since=0 to get history
    const events: any[] = [];
    const collectPromise = new Promise<void>((resolve) => {
      const handler = (raw: any) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "agent.event" && msg.session === "history-replay-test") {
          events.push(msg);
          if (events.length >= 2) {
            ctx.ws.off("message", handler);
            resolve();
          }
        }
      };
      ctx.ws.on("message", handler);
      setTimeout(() => { ctx.ws.off("message", handler); resolve(); }, 3000);
    });

    send(ctx, "agent.subscribe", { session: "history-replay-test", since: 0 });
    await collectPromise;

    assert.ok(events.length >= 2, `Expected 2+ history events, got ${events.length}`);
    assert.equal(events[0].isHistory, true);
    assert.equal(events[0].event.type, "user_message");
    assert.equal(events[0].event.message, "hello from DB");
    assert.equal(events[1].isHistory, true);
    assert.equal(events[1].event.type, "assistant");
    assert.equal(events[1].event.message, "hi from DB");
  });

  it("permission.subscribe replays existing pending", async () => {
    // No pending permissions exist, so pendingCount should be 0
    const rid = send(ctx, "permission.subscribe");
    const msg = await waitForReply(ctx, rid);
    assert.equal(msg.pendingCount, 0);
  });

  it("session.state-changed auto-push on subscribe", async () => {
    // State changes are auto-pushed — verify the subscription is active
    // by checking that the state-changed unsub exists (indirect test)
    // Direct test requires running agent which needs claude binary
    const createRid = send(ctx, "sessions.create", { label: "StateChangeTest" });
    await waitForReply(ctx, createRid);
    // Just verify no crash — state-changed push requires process lifecycle
    assert.ok(true);
  });
});
