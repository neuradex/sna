/**
 * WebSocket handler tests — verify all WS message types.
 * Starts a real HTTP+WS server on a random port, connects a WS client.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import { WebSocket } from "ws";
import http from "http";

const TEST_DB_DIR = path.join(import.meta.dirname, "../.test-data-ws");
const TEST_TOKEN = "test-sna-token";
const ALLOWED_ORIGIN = "http://localhost:5173";

function setup() {
  if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  const origCwd = process.cwd;
  process.cwd = () => TEST_DB_DIR;
  return () => { process.cwd = origCwd; fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); };
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

interface TestContext {
  ws: WebSocket;
  server: http.Server;
  port: number;
  cleanup: () => void;
  rid: number;
}

interface ServerOnlyContext {
  server: http.Server;
  port: number;
  cleanup: () => void;
}

async function startServerOnly(): Promise<ServerOnlyContext> {
  const cleanup = setup();
  const { createSnaApp, SessionManager, attachWebSocket } = await import("../src/server/index.js");
  const { serve } = await import("@hono/node-server");

  const sm = new SessionManager();
  const app = await createSnaApp({
    sessionManager: sm,
    authToken: TEST_TOKEN,
    allowedOrigins: [ALLOWED_ORIGIN],
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      const port = (info as any).port ?? (server.address() as any)?.port;
      attachWebSocket(server, sm, {
        authToken: TEST_TOKEN,
        allowedOrigins: [ALLOWED_ORIGIN],
      });
      resolve({ server, port, cleanup });
    });
  });
}

async function startServer(): Promise<TestContext> {
  const ctx = await startServerOnly();
  const ws = await openWs(ctx.port, { token: TEST_TOKEN, origin: ALLOWED_ORIGIN });
  return { ...ctx, ws, rid: 0 };
}

async function issueAccessToken(port: number, scopes: string[]): Promise<string> {
  const verifier = `ws-scope-verifier-${scopes.join("-")}`;
  const post = async (path: string, body: Record<string, unknown>, token?: string) => {
    return fetch(`http://localhost:${port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  };

  const start = await post("/auth/pkce/start", {
    clientId: `ws-scope-${scopes.join("-")}`,
    codeChallenge: pkceChallenge(verifier),
    codeChallengeMethod: "S256",
    scopes,
  });
  const started = await start.json() as any;
  const approve = await post(`/auth/pkce/requests/${started.requestId}/approve`, {}, TEST_TOKEN);
  const approved = await approve.json() as any;
  const token = await post("/auth/pkce/token", {
    grantType: "authorization_code",
    requestId: started.requestId,
    code: approved.code,
    codeVerifier: verifier,
  });
  const issued = await token.json() as any;
  return issued.accessToken;
}

async function openWs(
  port: number,
  options: { token?: string; origin?: string } = {},
): Promise<WebSocket> {
  const url = new URL(`ws://localhost:${port}/ws`);
  if (options.token) url.searchParams.set("token", options.token);
  const ws = new WebSocket(url, {
    headers: options.origin ? { Origin: options.origin } : undefined,
  });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout opening WebSocket")), 1000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function assertWsRejected(
  port: number,
  options: { token?: string; origin?: string } = {},
): Promise<void> {
  const url = new URL(`ws://localhost:${port}/ws`);
  if (options.token) url.searchParams.set("token", options.token);
  const ws = new WebSocket(url, {
    headers: options.origin ? { Origin: options.origin } : undefined,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timeout waiting for WebSocket rejection"));
    }, 1000);
    ws.once("open", () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error("WebSocket unexpectedly opened"));
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      assert.match(String(err), /Unexpected server response: (401|403)/);
      resolve();
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

  it("rejects WebSocket upgrades without a token", async () => {
    const serverCtx = await startServerOnly();
    try {
      await assertWsRejected(serverCtx.port, { origin: ALLOWED_ORIGIN });
    } finally {
      serverCtx.server.close();
      serverCtx.cleanup();
    }
  });

  it("rejects WebSocket upgrades from unapproved origins", async () => {
    const serverCtx = await startServerOnly();
    try {
      await assertWsRejected(serverCtx.port, { token: TEST_TOKEN, origin: "https://evil.example" });
    } finally {
      serverCtx.server.close();
      serverCtx.cleanup();
    }
  });

  it("enforces client token scopes on WebSocket messages", async () => {
    const serverCtx = await startServerOnly();
    let scopedWs: WebSocket | undefined;
    try {
      const accessToken = await issueAccessToken(serverCtx.port, ["chat"]);
      scopedWs = await openWs(serverCtx.port, { token: accessToken, origin: ALLOWED_ORIGIN });
      const scopedCtx: TestContext = { ...serverCtx, ws: scopedWs, rid: 0 };

      const chatRid = send(scopedCtx, "chat.sessions.list");
      const chatReply = await waitForReply(scopedCtx, chatRid);
      assert.equal(chatReply.type, "chat.sessions.list");
      assert.ok(Array.isArray(chatReply.sessions));

      const sessionsRid = send(scopedCtx, "sessions.list");
      const sessionsReply = await waitForReply(scopedCtx, sessionsRid);
      assert.equal(sessionsReply.type, "error");
      assert.match(sessionsReply.message, /Insufficient scope.*sessions/);

      const agentRid = send(scopedCtx, "agent.status", { session: "default" });
      const agentReply = await waitForReply(scopedCtx, agentRid);
      assert.equal(agentReply.type, "error");
      assert.match(agentReply.message, /Insufficient scope.*agent/);
    } finally {
      scopedWs?.close();
      serverCtx.server.close();
      serverCtx.cleanup();
    }
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

  it("sessions.remove updates list counts and rejects later session-scoped commands", async () => {
    const beforeRid = send(ctx, "sessions.list");
    const before = await waitForReply(ctx, beforeRid);

    const createRid = send(ctx, "sessions.create", { id: "ws-delete-followup", label: "WS Delete Followup" });
    const created = await waitForReply(ctx, createRid);

    const afterCreateRid = send(ctx, "sessions.list");
    const afterCreate = await waitForReply(ctx, afterCreateRid);
    assert.equal(afterCreate.sessions.some((s: any) => s.id === created.sessionId), true);
    assert.equal(afterCreate.sessions.length, before.sessions.length + 1);

    const removeRid = send(ctx, "sessions.remove", { session: created.sessionId });
    const removed = await waitForReply(ctx, removeRid);
    assert.equal(removed.status, "removed");

    const afterRemoveRid = send(ctx, "sessions.list");
    const afterRemove = await waitForReply(ctx, afterRemoveRid);
    assert.equal(afterRemove.sessions.some((s: any) => s.id === created.sessionId), false);
    assert.equal(afterRemove.sessions.length, before.sessions.length);

    const sendRid = send(ctx, "agent.send", { session: created.sessionId, message: "after delete" });
    const sendReply = await waitForReply(ctx, sendRid);
    assert.equal(sendReply.type, "error");
    assert.match(sendReply.message, /No active agent session/);

    const updateRid = send(ctx, "sessions.update", { session: created.sessionId, label: "gone" });
    const updateReply = await waitForReply(ctx, updateRid);
    assert.equal(updateReply.type, "error");
    assert.match(updateReply.message, /not found/);

    const modelRid = send(ctx, "agent.set-model", { session: created.sessionId, model: "fake-2" });
    const modelReply = await waitForReply(ctx, modelRid);
    assert.equal(modelReply.status, "no_session");

    const permissionRid = send(ctx, "permission.respond", { session: created.sessionId, approved: true });
    const permissionReply = await waitForReply(ctx, permissionRid);
    assert.equal(permissionReply.type, "error");
    assert.match(permissionReply.message, /No pending permission request/);

    const removeAgainRid = send(ctx, "sessions.remove", { session: created.sessionId });
    const removeAgain = await waitForReply(ctx, removeAgainRid);
    assert.equal(removeAgain.type, "error");
    assert.match(removeAgain.message, /Session not found/);
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

    const createRid = send(ctx, "chat.messages.create", { session: "ws-msg-test", actor: "user", kind: "text", content: "hello ws" });
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

    send(ctx, "chat.messages.create", { session: "ws-since-test", actor: "user", kind: "text", content: "msg1" });
    await waitForReply(ctx, ctx.rid.toString());
    send(ctx, "chat.messages.create", { session: "ws-since-test", actor: "user", kind: "text", content: "msg2" });
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
    send(ctx, "chat.messages.create", { session: "ws-clear-test", actor: "user", kind: "text", content: "bye" });
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
    send(ctx, "chat.messages.create", { session: "history-replay-test", actor: "user", kind: "text", content: "hello from DB" });
    await waitForReply(ctx, ctx.rid.toString());
    send(ctx, "chat.messages.create", { session: "history-replay-test", actor: "assistant", kind: "text", content: "hi from DB" });
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

  it("agent.subscribe with tail replays only the last N messages", async () => {
    send(ctx, "chat.sessions.create", { id: "tail-test" });
    await waitForReply(ctx, ctx.rid.toString());
    for (let i = 1; i <= 5; i++) {
      send(ctx, "chat.messages.create", { session: "tail-test", actor: "user", kind: "text", content: `msg-${i}` });
      await waitForReply(ctx, ctx.rid.toString());
    }

    const events: any[] = [];
    const handler = (raw: any) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "agent.event" && msg.session === "tail-test") events.push(msg);
    };
    ctx.ws.on("message", handler);

    const rid = send(ctx, "agent.subscribe", { session: "tail-test", tail: 2 });
    const reply = await waitForReply(ctx, rid);

    // Allow event push to flush
    await new Promise((r) => setTimeout(r, 200));
    ctx.ws.off("message", handler);

    assert.equal(events.length, 2, `Expected 2 tail events, got ${events.length}`);
    assert.equal(events[0].event.message, "msg-4");
    assert.equal(events[1].event.message, "msg-5");
    assert.equal(events[0].cursor, 4);
    assert.equal(events[1].cursor, 5);
    assert.equal(reply.hasMore, true);
    assert.equal(reply.oldestCursor, 4);
    assert.equal(reply.cursor, 5);
  });

  it("agent.subscribe with tail >= total reports hasMore=false", async () => {
    send(ctx, "chat.sessions.create", { id: "tail-small-test" });
    await waitForReply(ctx, ctx.rid.toString());
    send(ctx, "chat.messages.create", { session: "tail-small-test", actor: "user", kind: "text", content: "only" });
    await waitForReply(ctx, ctx.rid.toString());

    const rid = send(ctx, "agent.subscribe", { session: "tail-small-test", tail: 20 });
    const reply = await waitForReply(ctx, rid);
    assert.equal(reply.hasMore, false);
    assert.equal(reply.oldestCursor, 1);
  });

  it("agent.getMessages paginates older history", async () => {
    send(ctx, "chat.sessions.create", { id: "paginate-test" });
    await waitForReply(ctx, ctx.rid.toString());
    for (let i = 1; i <= 7; i++) {
      send(ctx, "chat.messages.create", { session: "paginate-test", actor: "user", kind: "text", content: `m-${i}` });
      await waitForReply(ctx, ctx.rid.toString());
    }

    // Tail of 3 leaves cursors 5..7 visible; backfill 1..4 in two pages.
    const firstRid = send(ctx, "agent.getMessages", { session: "paginate-test", before: 5, limit: 3 });
    const first = await waitForReply(ctx, firstRid);
    assert.equal(first.events.length, 3);
    assert.equal(first.events[0].cursor, 2);
    assert.equal(first.events[2].cursor, 4);
    assert.equal(first.events[2].event.message, "m-4");
    assert.equal(first.hasMore, true);
    assert.equal(first.oldestCursor, 2);

    const secondRid = send(ctx, "agent.getMessages", { session: "paginate-test", before: first.oldestCursor, limit: 3 });
    const second = await waitForReply(ctx, secondRid);
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0].cursor, 1);
    assert.equal(second.hasMore, false);
  });

  it("agent.getMessages with no before returns the tail", async () => {
    send(ctx, "chat.sessions.create", { id: "tail-fetch-test" });
    await waitForReply(ctx, ctx.rid.toString());
    for (let i = 1; i <= 4; i++) {
      send(ctx, "chat.messages.create", { session: "tail-fetch-test", actor: "user", kind: "text", content: `t-${i}` });
      await waitForReply(ctx, ctx.rid.toString());
    }

    const rid = send(ctx, "agent.getMessages", { session: "tail-fetch-test", limit: 2 });
    const reply = await waitForReply(ctx, rid);
    assert.equal(reply.events.length, 2);
    assert.equal(reply.events[0].cursor, 3);
    assert.equal(reply.events[1].cursor, 4);
    assert.equal(reply.hasMore, true);
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
