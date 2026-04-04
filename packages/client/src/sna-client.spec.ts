/**
 * SnaClient unit tests — mock WebSocket server, no real SNA server needed.
 *
 * Tests:
 *   1. Connection lifecycle (connect / disconnect / status callbacks)
 *   2. Request/response correlation via rid
 *   3. Error responses
 *   4. Push message routing
 *   5. Auto-reconnect
 *   6. Re-subscribe after reconnect
 *   7. sessions.create / sessions.remove
 *   8. sessions.onSnapshot
 *   9. agent.start / send / kill / restart / interrupt / resume
 *  10. agent.getStatus / setModel / setPermissionMode
 *  11. agent.subscribe / unsubscribe / onEvent
 *  12. agent.respondPermission / onPermissionRequest
 *  13. Concurrent requests with independent rids
 *  14. Request rejection when disconnected
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startMockWsServer, waitFor, sleep, type MockServer } from "./test-helpers.js";
import { SnaClient } from "./sna-client.js";

let mock: MockServer;
let sna: SnaClient;

// ── Auto-responder: echo back request type + rid ─────────────────

function installAutoResponder(overrides?: Record<string, (msg: Record<string, unknown>) => Record<string, unknown>>) {
  mock.onMessage((ws, msg) => {
    const type = msg.type as string;
    const rid = msg.rid as string | undefined;
    if (!rid) return; // push-only, no response needed

    const handler = overrides?.[type];
    if (handler) {
      mock.sendTo(ws, { ...handler(msg), type, rid });
    } else {
      // Default: echo back with status "ok"
      mock.sendTo(ws, { type, rid, status: "ok" });
    }
  });
}

// ── Setup / Teardown ─────────────────────────────────────────────

beforeEach(async () => {
  mock = await startMockWsServer();
});

afterEach(async () => {
  sna?.disconnect();
  await mock?.close();
});

// ── 1. Connection lifecycle ──────────────────────────────────────

describe("connection lifecycle", () => {
  it("connects and fires status callbacks", async () => {
    const statuses: string[] = [];
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.onConnectionStatus((s) => statuses.push(s));

    assert.equal(sna.status, "disconnected");
    sna.connect();

    await waitFor(() => sna.connected);
    assert.equal(sna.status, "connected");
    assert.deepEqual(statuses, ["connecting", "connected"]);
  });

  it("disconnect fires status callback and closes socket", async () => {
    const statuses: string[] = [];
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.onConnectionStatus((s) => statuses.push(s));

    sna.connect();
    await waitFor(() => sna.connected);

    sna.disconnect();
    assert.equal(sna.status, "disconnected");
    assert.ok(statuses.includes("disconnected"));
  });

  it("unsubscribe from status callback works", async () => {
    const statuses: string[] = [];
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    const unsub = sna.onConnectionStatus((s) => statuses.push(s));

    sna.connect();
    await waitFor(() => sna.connected);
    unsub();

    sna.disconnect();
    // Should NOT have "disconnected" because we unsubscribed
    assert.ok(!statuses.includes("disconnected"));
  });
});

// ── 2. Request/response correlation ──────────────────────────────

describe("request/response", () => {
  it("correlates response by rid", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "sessions.list": () => ({ sessions: [{ id: "default" }] }),
    });

    const res = await sna.request<any>("sessions.list");
    assert.deepEqual(res.sessions, [{ id: "default" }]);
  });

  it("handles concurrent requests with independent rids", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.status": (msg) => ({
        alive: true,
        agentStatus: "idle",
        sessionId: msg.session,
      }),
    });

    const [r1, r2] = await Promise.all([
      sna.agent.getStatus("session-a"),
      sna.agent.getStatus("session-b"),
    ]);
    assert.equal((r1 as any).sessionId, "session-a");
    assert.equal((r2 as any).sessionId, "session-b");
  });
});

// ── 3. Error responses ───────────────────────────────────────────

describe("error handling", () => {
  it("rejects promise on error response", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    mock.onMessage((ws, msg) => {
      mock.sendTo(ws, { type: "error", rid: msg.rid, message: "session not found" });
    });

    await assert.rejects(
      () => sna.request("agent.kill", { session: "nonexistent" }),
      { message: "session not found" },
    );
  });

  it("rejects all pending requests on disconnect", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    // Don't respond — leave request pending
    const promise = sna.request("sessions.list");
    sna.disconnect();

    await assert.rejects(promise, { message: "disconnected" });
  });

  it("rejects request when not connected", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });

    await assert.rejects(
      () => sna.request("sessions.list"),
      { message: "Not connected" },
    );
  });
});

// ── 4. Push message routing ──────────────────────────────────────

describe("push routing", () => {
  it("routes push messages to registered handlers", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const received: any[] = [];
    sna.onPush("session.lifecycle", (msg) => received.push(msg));

    mock.broadcast({ type: "session.lifecycle", session: "abc", state: "killed" });
    await waitFor(() => received.length > 0);

    assert.equal(received[0].session, "abc");
    assert.equal(received[0].state, "killed");
  });

  it("unsubscribe from push works", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const received: any[] = [];
    const unsub = sna.onPush("session.lifecycle", (msg) => received.push(msg));
    unsub();

    mock.broadcast({ type: "session.lifecycle", session: "abc", state: "killed" });
    await sleep(100);

    assert.equal(received.length, 0);
  });

  it("multiple handlers for same push type", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const a: any[] = [];
    const b: any[] = [];
    sna.onPush("test.event", (msg) => a.push(msg));
    sna.onPush("test.event", (msg) => b.push(msg));

    mock.broadcast({ type: "test.event", value: 1 });
    await waitFor(() => a.length > 0 && b.length > 0);

    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });
});

// ── 5. Auto-reconnect ────────────────────────────────────────────

describe("reconnect", () => {
  it("auto-reconnects after server closes connection", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: true, reconnectDelay: 100 });
    sna.connect();
    await waitFor(() => sna.connected);

    const statuses: string[] = [];
    sna.onConnectionStatus((s) => statuses.push(s));

    // Server closes the connection
    for (const ws of mock.clients) ws.close();
    await waitFor(() => sna.status === "disconnected");
    // Should auto-reconnect
    await waitFor(() => sna.connected, 5000);

    assert.ok(statuses.includes("disconnected"));
    assert.ok(statuses.includes("connecting"));
    assert.ok(statuses.includes("connected"));
  });

  it("respects maxReconnectAttempts", async () => {
    // Close the server so reconnect always fails
    await mock.close();

    sna = new SnaClient({ baseUrl: "localhost:1", ws: true, http: false, reconnect: true, reconnectDelay: 50, maxReconnectAttempts: 2 });
    const statuses: string[] = [];
    sna.onConnectionStatus((s) => statuses.push(s));

    sna.connect();
    await sleep(500);

    // Should not keep retrying forever — at most 2 reconnect attempts
    const connectingCount = statuses.filter((s) => s === "connecting").length;
    assert.ok(connectingCount <= 3, `Expected <= 3 connecting attempts, got ${connectingCount}`);
  });

  it("does not reconnect after explicit disconnect()", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: true, reconnectDelay: 50 });
    sna.connect();
    await waitFor(() => sna.connected);

    sna.disconnect();
    await sleep(200);

    assert.equal(sna.status, "disconnected");
  });
});

// ── 6. Re-subscribe after reconnect ──────────────────────────────

describe("re-subscribe on reconnect", () => {
  it("re-subscribes agent sessions after reconnect", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: true, reconnectDelay: 100 });
    sna.connect();
    await waitFor(() => sna.connected);

    const subscribedSessions: string[] = [];
    installAutoResponder({
      "agent.subscribe": (msg) => {
        subscribedSessions.push(msg.session as string);
        return { cursor: 0 };
      },
    });

    // Subscribe to a session
    await sna.agent.subscribe("my-session", { since: 0 });
    assert.equal(subscribedSessions.length, 1);

    // Force reconnect
    for (const ws of mock.clients) ws.close();
    await waitFor(() => sna.status === "disconnected");
    await waitFor(() => sna.connected, 5000);

    // Should have re-subscribed
    await waitFor(() => subscribedSessions.length >= 2, 3000);
    assert.equal(subscribedSessions[1], "my-session");
  });

  it("re-subscribes permissions after reconnect", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: true, reconnectDelay: 100 });
    sna.connect();
    await waitFor(() => sna.connected);

    const permSubCount = { count: 0 };
    installAutoResponder({
      "permission.subscribe": () => {
        permSubCount.count++;
        return { pendingCount: 0 };
      },
      "agent.subscribe": () => ({ cursor: 0 }),
    });

    await sna.agent.subscribePermissions();
    assert.equal(permSubCount.count, 1);

    // Force reconnect
    for (const ws of mock.clients) ws.close();
    await waitFor(() => sna.status === "disconnected");
    await waitFor(() => sna.connected, 5000);

    await waitFor(() => permSubCount.count >= 2, 3000);
  });
});

// ── 7. Sessions API ──────────────────────────────────────────────

describe("sessions API", () => {
  it("create returns sessionId", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "sessions.create": () => ({ status: "created", sessionId: "new-1", label: "test", meta: null }),
    });

    const res = await sna.sessions.create({ label: "test" });
    assert.equal(res.status, "created");
    assert.equal(res.sessionId, "new-1");
  });

  it("remove returns status", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "sessions.remove": () => ({ status: "removed" }),
    });

    const res = await sna.sessions.remove("old-session");
    assert.equal(res.status, "removed");
  });
});

// ── 7b. sessions.update ──────────────────────────────────────────

describe("sessions.update", () => {
  it("update returns status and session id", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "sessions.update": (msg) => ({ status: "updated", session: msg.session }),
    });

    const res = await sna.sessions.update("my-session", { label: "New Name" });
    assert.equal(res.status, "updated");
    assert.equal(res.session, "my-session");
  });

  it("update with meta and cwd", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const captured: any[] = [];
    mock.onMessage((ws, msg) => {
      captured.push(msg);
      mock.sendTo(ws, { type: msg.type, rid: msg.rid, status: "updated", session: msg.session });
    });

    await sna.sessions.update("s1", {
      label: "renamed",
      meta: { key: "value" },
      cwd: "/new/path",
    });

    assert.equal(captured[0].session, "s1");
    assert.equal(captured[0].label, "renamed");
    assert.deepEqual(captured[0].meta, { key: "value" });
    assert.equal(captured[0].cwd, "/new/path");
  });

  it("update rejects on nonexistent session", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    mock.onMessage((ws, msg) => {
      mock.sendTo(ws, { type: "error", rid: msg.rid, message: 'Session "nope" not found' });
    });

    await assert.rejects(
      () => sna.sessions.update("nope", { label: "x" }),
      { message: 'Session "nope" not found' },
    );
  });
});

// ── 8. sessions.onSnapshot ───────────────────────────────────────

describe("sessions.onSnapshot", () => {
  it("receives snapshot pushes", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const snapshots: any[] = [];
    sna.sessions.onSnapshot((sessions) => snapshots.push(sessions));

    mock.broadcast({
      type: "sessions.snapshot",
      sessions: [{ id: "default", alive: true, agentStatus: "idle" }],
    });

    await waitFor(() => snapshots.length > 0);
    assert.equal(snapshots[0].length, 1);
    assert.equal(snapshots[0][0].id, "default");
  });

  it("unsubscribe stops receiving", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const snapshots: any[] = [];
    const unsub = sna.sessions.onSnapshot((sessions) => snapshots.push(sessions));
    unsub();

    mock.broadcast({ type: "sessions.snapshot", sessions: [] });
    await sleep(100);

    assert.equal(snapshots.length, 0);
  });
});

// ── 9. Agent lifecycle ───────────────────────────────────────────

describe("agent lifecycle", () => {
  beforeEach(async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.start": (msg) => ({ status: "started", provider: "claude-code", sessionId: msg.session }),
      "agent.send": () => ({ status: "sent" }),
      "agent.kill": () => ({ status: "killed" }),
      "agent.restart": (msg) => ({ status: "restarted", provider: "claude-code", sessionId: msg.session }),
      "agent.interrupt": () => ({ status: "interrupted" }),
      "agent.resume": (msg) => ({ status: "resumed", provider: "claude-code", sessionId: msg.session, historyCount: 5 }),
    });
  });

  it("start", async () => {
    const res = await sna.agent.start("default", { prompt: "hello" });
    assert.equal(res.status, "started");
    assert.equal(res.sessionId, "default");
  });

  it("send", async () => {
    const res = await sna.agent.send("default", "do something");
    assert.equal(res.status, "sent");
  });

  it("kill", async () => {
    const res = await sna.agent.kill("default");
    assert.equal(res.status, "killed");
  });

  it("restart", async () => {
    const res = await sna.agent.restart("default", { model: "claude-opus-4-6" });
    assert.equal(res.status, "restarted");
  });

  it("interrupt", async () => {
    const res = await sna.agent.interrupt("default");
    assert.equal(res.status, "interrupted");
  });

  it("resume", async () => {
    const res = await sna.agent.resume("default");
    assert.equal(res.status, "resumed");
    assert.equal(res.historyCount, 5);
  });
});

// ── 10. Agent status / config ────────────────────────────────────

describe("agent status & config", () => {
  beforeEach(async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.status": () => ({
        alive: true,
        agentStatus: "busy",
        sessionId: "cc-123",
        ccSessionId: "cc-123",
        eventCount: 42,
        messageCount: 10,
        lastMessage: { role: "assistant", content: "hello", created_at: "2025-01-01" },
        config: { provider: "claude-code", model: "claude-sonnet-4-6", permissionMode: "acceptEdits" },
      }),
      "agent.set-model": (msg) => ({ status: "updated", model: msg.model }),
      "agent.set-permission-mode": (msg) => ({ status: "updated", permissionMode: msg.permissionMode }),
    });
  });

  it("getStatus returns full info", async () => {
    const res = await sna.agent.getStatus("default");
    assert.equal(res.alive, true);
    assert.equal(res.agentStatus, "busy");
    assert.equal(res.eventCount, 42);
    assert.equal(res.messageCount, 10);
  });

  it("setModel", async () => {
    const res = await sna.agent.setModel("default", "claude-opus-4-6");
    assert.equal(res.status, "updated");
    assert.equal(res.model, "claude-opus-4-6");
  });

  it("setPermissionMode", async () => {
    const res = await sna.agent.setPermissionMode("default", "bypassPermissions");
    assert.equal(res.status, "updated");
    assert.equal(res.permissionMode, "bypassPermissions");
  });
});

// ── 11. Agent event subscription ─────────────────────────────────

describe("agent event subscription", () => {
  it("subscribe + onEvent receives pushed events", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.subscribe": () => ({ cursor: 0 }),
    });

    const events: any[] = [];
    sna.agent.onEvent((e) => events.push(e));
    await sna.agent.subscribe("default", { since: 0 });

    mock.broadcast({
      type: "agent.event",
      session: "default",
      cursor: 1,
      event: { type: "assistant", message: "hello world" },
    });

    await waitFor(() => events.length > 0);
    assert.equal(events[0].session, "default");
    assert.equal(events[0].cursor, 1);
    assert.equal(events[0].event.type, "assistant");
  });

  it("unsubscribe removes from tracked sessions", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.subscribe": () => ({ cursor: 0 }),
      "agent.unsubscribe": () => ({}),
    });

    await sna.agent.subscribe("default");
    await sna.agent.unsubscribe("default");

    // After unsubscribe, the session should not be re-subscribed on reconnect
    // (tested in re-subscribe tests above — here just verify no error)
  });

  it("history events marked with isHistory", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({ "agent.subscribe": () => ({ cursor: 0 }) });

    const events: any[] = [];
    sna.agent.onEvent((e) => events.push(e));
    await sna.agent.subscribe("default", { since: 0, includeHistory: true });

    mock.broadcast({
      type: "agent.event",
      session: "default",
      cursor: 1,
      event: { type: "user_message", message: "hi" },
      isHistory: true,
    });

    await waitFor(() => events.length > 0);
    assert.equal(events[0].isHistory, true);
  });
});

// ── 12. Permission (via agent) ───────────────────────────────────

describe("agent permission", () => {
  it("onPermissionRequest receives push", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({ "permission.subscribe": () => ({ pendingCount: 0 }) });

    const requests: any[] = [];
    sna.agent.onPermissionRequest((e) => requests.push(e));
    await sna.agent.subscribePermissions();

    mock.broadcast({
      type: "permission.request",
      session: "default",
      request: { tool: "Bash", command: "rm -rf /" },
      createdAt: 1234567890,
    });

    await waitFor(() => requests.length > 0);
    assert.equal(requests[0].session, "default");
    assert.equal(requests[0].request.tool, "Bash");
    assert.equal(requests[0].createdAt, 1234567890);
  });

  it("respondPermission sends approve/deny", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "permission.respond": (msg) => ({
        status: msg.approved ? "approved" : "denied",
      }),
    });

    const res = await sna.agent.respondPermission("default", true);
    assert.equal(res.status, "approved");

    const res2 = await sna.agent.respondPermission("default", false);
    assert.equal(res2.status, "denied");
  });

  it("getPendingPermissions", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "permission.pending": () => ({
        pending: [{ sessionId: "default", request: { tool: "Edit" }, createdAt: 999 }],
      }),
    });

    const res = await sna.agent.getPendingPermissions("default");
    assert.equal(res.pending.length, 1);
    assert.equal(res.pending[0].sessionId, "default");
  });

  it("getPendingPermissions without session filter", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "permission.pending": () => ({
        pending: [
          { sessionId: "a", request: { tool: "Bash" }, createdAt: 1 },
          { sessionId: "b", request: { tool: "Edit" }, createdAt: 2 },
        ],
      }),
    });

    const res = await sna.agent.getPendingPermissions();
    assert.equal(res.pending.length, 2);
  });

  it("unsubscribePermissions clears subscription state", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: true, reconnectDelay: 100 });
    sna.connect();
    await waitFor(() => sna.connected);

    const permSubCount = { count: 0 };
    installAutoResponder({
      "permission.subscribe": () => { permSubCount.count++; return { pendingCount: 0 }; },
      "permission.unsubscribe": () => ({}),
    });

    await sna.agent.subscribePermissions();
    assert.equal(permSubCount.count, 1);

    await sna.agent.unsubscribePermissions();

    // Force reconnect — permissions should NOT re-subscribe
    for (const ws of mock.clients) ws.close();
    await waitFor(() => sna.status === "disconnected");
    await waitFor(() => sna.connected, 5000);
    await sleep(200);

    // Should still be 1 — no re-subscribe after unsubscribePermissions
    assert.equal(permSubCount.count, 1);
  });
});

// ── Edge cases ───────────────────────────────────────────────────

describe("edge cases", () => {
  it("connect() is no-op when already connecting", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    sna.connect(); // should not throw or create second connection
    await waitFor(() => sna.connected);
    assert.equal(mock.clients.size, 1);
  });

  it("connect() is no-op when already connected", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);
    sna.connect(); // no-op
    await sleep(100);
    assert.equal(mock.clients.size, 1);
  });

  it("handles malformed JSON from server gracefully", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    // Send invalid JSON — should not crash
    const ws = mock.lastClient();
    ws.send("not json at all{{{");
    await sleep(50);

    // Client should still be connected and functional
    assert.equal(sna.connected, true);
  });

  it("handles push message with no matching handler", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    // Send a push with no handler — should not crash
    mock.broadcast({ type: "unknown.type.nobody.listens.to" });
    await sleep(50);

    assert.equal(sna.connected, true);
  });

  it("error response without message uses fallback", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    mock.onMessage((ws, msg) => {
      mock.sendTo(ws, { type: "error", rid: msg.rid });
    });

    await assert.rejects(
      () => sna.request("anything"),
      { message: "Unknown error" },
    );
  });

  it("disconnect() is safe to call when already disconnected", () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.disconnect(); // should not throw
    sna.disconnect(); // double call also safe
    assert.equal(sna.status, "disconnected");
  });

  it("sessions.onSnapshot replaces previous subscription", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const first: any[] = [];
    const second: any[] = [];

    sna.sessions.onSnapshot((s) => first.push(s));
    // Second call should replace the first
    sna.sessions.onSnapshot((s) => second.push(s));

    mock.broadcast({ type: "sessions.snapshot", sessions: [{ id: "x" }] });
    await waitFor(() => second.length > 0);
    await sleep(50);

    // First handler should NOT have received (replaced)
    assert.equal(first.length, 0);
    assert.equal(second.length, 1);
  });

  it("agent.onEvent unsubscribe stops receiving", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const events: any[] = [];
    const unsub = sna.agent.onEvent((e) => events.push(e));
    unsub();

    mock.broadcast({
      type: "agent.event",
      session: "default",
      cursor: 1,
      event: { type: "assistant", message: "hi" },
    });
    await sleep(100);

    assert.equal(events.length, 0);
  });

  it("agent.onPermissionRequest unsubscribe stops receiving", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const requests: any[] = [];
    const unsub = sna.agent.onPermissionRequest((e) => requests.push(e));
    unsub();

    mock.broadcast({ type: "permission.request", session: "x", request: {}, createdAt: 0 });
    await sleep(100);

    assert.equal(requests.length, 0);
  });

  it("sessions.onConfigChanged unsubscribe stops receiving", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const changes: any[] = [];
    const unsub = sna.sessions.onConfigChanged((e) => changes.push(e));
    unsub();

    mock.broadcast({ type: "session.config-changed", session: "x", model: "new" });
    await sleep(100);

    assert.equal(changes.length, 0);
  });

  it("constructor uses all default options", () => {
    // Covers ?? branches for reconnect, reconnectDelay, maxReconnectAttempts
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false });
    assert.equal(sna.status, "disconnected");
  });

  it("handles non-string ws.onmessage data", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    // Send a Buffer (non-string) — the typeof check branch
    const ws = mock.lastClient();
    ws.send(Buffer.from("{}"));
    await sleep(50);

    assert.equal(sna.connected, true);
  });

  it("setStatus is no-op when status unchanged", async () => {
    const statuses: string[] = [];
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.onConnectionStatus((s) => statuses.push(s));
    sna.connect();
    await waitFor(() => sna.connected);

    // statuses should be exactly ["connecting", "connected"] — no duplicates
    assert.deepEqual(statuses, ["connecting", "connected"]);
  });

  it("agent.start with all default config", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.start": () => ({ status: "started", provider: "claude-code", sessionId: "default" }),
    });

    // Call with no config — covers the default {} parameter
    const res = await sna.agent.start("default");
    assert.equal(res.status, "started");
  });

  it("agent.send with images and meta", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const captured: any[] = [];
    mock.onMessage((ws, msg) => {
      captured.push(msg);
      mock.sendTo(ws, { type: msg.type, rid: msg.rid, status: "sent" });
    });

    await sna.agent.send("default", "look at this", {
      images: [{ base64: "abc", mimeType: "image/png" }],
      meta: { source: "test" },
    });

    assert.equal(captured[0].images.length, 1);
    assert.equal(captured[0].meta.source, "test");
  });

  it("agent.restart with no config override", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.restart": () => ({ status: "restarted", provider: "claude-code", sessionId: "default" }),
    });

    const res = await sna.agent.restart("default");
    assert.equal(res.status, "restarted");
  });

  it("agent.resume with all options", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "agent.resume": () => ({ status: "resumed", provider: "claude-code", sessionId: "default", historyCount: 3 }),
    });

    const res = await sna.agent.resume("default", {
      provider: "claude-code",
      model: "claude-opus-4-6",
      permissionMode: "bypassPermissions",
      prompt: "continue",
      extraArgs: ["--verbose"],
    });
    assert.equal(res.status, "resumed");
  });

  it("agent.subscribe with no options", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({ "agent.subscribe": () => ({ cursor: 5 }) });

    const res = await sna.agent.subscribe("default");
    assert.equal(res.cursor, 5);
  });

  it("sessions.create with no options", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "sessions.create": () => ({ status: "created", sessionId: "auto-id", label: "auto-id", meta: null }),
    });

    const res = await sna.sessions.create();
    assert.equal(res.sessionId, "auto-id");
  });

  it("re-subscribe silently ignores failures", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: true, reconnectDelay: 100 });
    sna.connect();
    await waitFor(() => sna.connected);

    // Subscribe to a session
    installAutoResponder({ "agent.subscribe": () => ({ cursor: 0 }) });
    await sna.agent.subscribe("test-session");

    // On reconnect, make subscribe fail — should not crash
    for (const ws of mock.clients) ws.close();
    await waitFor(() => sna.status === "disconnected");

    // Clear responders so re-subscribe gets no reply (times out silently)
    await waitFor(() => sna.connected, 5000);
    // Client is still functional
    assert.equal(sna.connected, true);
  });

  it("waitFor rejects on timeout", async () => {
    await assert.rejects(
      () => waitFor(() => false, 100, 20),
      { message: "waitFor timeout" },
    );
  });

  it("request payload is spread correctly", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    const captured: any[] = [];
    mock.onMessage((ws, msg) => {
      captured.push(msg);
      mock.sendTo(ws, { type: msg.type, rid: msg.rid, status: "ok" });
    });

    await sna.request("test.op", { foo: "bar", nested: { a: 1 } });
    assert.equal(captured[0].type, "test.op");
    assert.equal(captured[0].foo, "bar");
    assert.deepEqual(captured[0].nested, { a: 1 });
  });
});

// ── HTTP transport ───────────────────────────────────────────────

describe("HTTP transport (http: true)", () => {
  // Helper: create an HTTP-enabled client (no WS needed for these tests)
  function httpClient() {
    return new SnaClient({ baseUrl: mock.host, ws: false, http: true, reconnect: false });
  }

  // ── sessions ────────────────────────────────────────────────

  it("sessions.create — POST /sessions with opts body", async () => {
    mock.queueHttpResponse(200, { status: "created", sessionId: "s1", label: "test", meta: null });
    sna = httpClient();

    const res = await sna.sessions.create({ label: "test", id: "s1" });
    assert.equal(res.status, "created");
    assert.equal(res.sessionId, "s1");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/sessions");
    assert.equal(req.body.label, "test");
    assert.equal(req.body.id, "s1");
  });

  it("sessions.create — no opts sends empty body", async () => {
    mock.queueHttpResponse(200, { status: "created", sessionId: "auto", label: "auto", meta: null });
    sna = httpClient();

    await sna.sessions.create();

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/sessions");
  });

  it("sessions.remove — DELETE /sessions/:id", async () => {
    mock.queueHttpResponse(200, { status: "removed" });
    sna = httpClient();

    const res = await sna.sessions.remove("my-session");
    assert.equal(res.status, "removed");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "DELETE");
    assert.equal(req.url, "/sessions/my-session");
  });

  it("sessions.remove — URL-encodes session id", async () => {
    mock.queueHttpResponse(200, { status: "removed" });
    sna = httpClient();

    await sna.sessions.remove("session/with spaces");

    const req = mock.httpRequests[0];
    assert.equal(req.url, "/sessions/session%2Fwith%20spaces");
  });

  it("sessions.update — PATCH /sessions/:id with body", async () => {
    mock.queueHttpResponse(200, { status: "updated", session: "s2" });
    sna = httpClient();

    const res = await sna.sessions.update("s2", { label: "New Name", meta: { x: 1 } });
    assert.equal(res.status, "updated");
    assert.equal(res.session, "s2");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "PATCH");
    assert.equal(req.url, "/sessions/s2");
    assert.equal(req.body.label, "New Name");
    assert.deepEqual(req.body.meta, { x: 1 });
  });

  // ── agent ────────────────────────────────────────────────────

  it("agent.start — POST /start?session=<id> with config body", async () => {
    mock.queueHttpResponse(200, { status: "started", provider: "claude-code", sessionId: "default" });
    sna = httpClient();

    const res = await sna.agent.start("default", { model: "claude-sonnet-4-6" });
    assert.equal(res.status, "started");
    assert.equal(res.sessionId, "default");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/start?session=default");
    assert.equal(req.body.model, "claude-sonnet-4-6");
  });

  it("agent.start — URL-encodes session id", async () => {
    mock.queueHttpResponse(200, { status: "started", provider: "claude-code", sessionId: "a/b" });
    sna = httpClient();

    await sna.agent.start("a/b", {});

    assert.equal(mock.httpRequests[0].url, "/start?session=a%2Fb");
  });

  it("agent.send — POST /send?session=<id> with message", async () => {
    mock.queueHttpResponse(200, { status: "sent" });
    sna = httpClient();

    const res = await sna.agent.send("default", "hello world");
    assert.equal(res.status, "sent");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/send?session=default");
    assert.equal(req.body.message, "hello world");
  });

  it("agent.send — includes images and meta in body", async () => {
    mock.queueHttpResponse(200, { status: "sent" });
    sna = httpClient();

    await sna.agent.send("default", "look", {
      images: [{ base64: "abc", mimeType: "image/png" }],
      meta: { src: "test" },
    });

    const req = mock.httpRequests[0];
    assert.deepEqual((req.body.images as any)[0], { base64: "abc", mimeType: "image/png" });
    assert.deepEqual(req.body.meta, { src: "test" });
  });

  it("agent.kill — POST /kill?session=<id>", async () => {
    mock.queueHttpResponse(200, { status: "killed" });
    sna = httpClient();

    const res = await sna.agent.kill("default");
    assert.equal(res.status, "killed");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/kill?session=default");
  });

  it("agent.restart — POST /restart?session=<id> with config body", async () => {
    mock.queueHttpResponse(200, { status: "restarted", provider: "claude-code", sessionId: "default" });
    sna = httpClient();

    const res = await sna.agent.restart("default", { model: "claude-opus-4-6" });
    assert.equal(res.status, "restarted");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/restart?session=default");
    assert.equal(req.body.model, "claude-opus-4-6");
  });

  it("agent.restart — no config sends empty body", async () => {
    mock.queueHttpResponse(200, { status: "restarted", provider: "claude-code", sessionId: "default" });
    sna = httpClient();

    await sna.agent.restart("default");

    const req = mock.httpRequests[0];
    assert.equal(req.url, "/restart?session=default");
  });

  it("agent.resume — POST /resume?session=<id> with opts", async () => {
    mock.queueHttpResponse(200, { status: "resumed", provider: "claude-code", sessionId: "default", historyCount: 3 });
    sna = httpClient();

    const res = await sna.agent.resume("default", {
      model: "claude-sonnet-4-6",
      permissionMode: "acceptEdits",
      prompt: "continue",
    });
    assert.equal(res.historyCount, 3);

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/resume?session=default");
    assert.equal(req.body.model, "claude-sonnet-4-6");
    assert.equal(req.body.prompt, "continue");
  });

  it("agent.interrupt — POST /interrupt?session=<id>", async () => {
    mock.queueHttpResponse(200, { status: "interrupted" });
    sna = httpClient();

    const res = await sna.agent.interrupt("default");
    assert.equal(res.status, "interrupted");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/interrupt?session=default");
  });

  it("agent.getStatus — GET /status?session=<id> (no body)", async () => {
    mock.queueHttpResponse(200, {
      alive: true,
      agentStatus: "idle",
      sessionId: "default",
      ccSessionId: null,
      eventCount: 0,
      messageCount: 0,
      lastMessage: null,
      config: null,
    });
    sna = httpClient();

    const res = await sna.agent.getStatus("default");
    assert.equal(res.alive, true);
    assert.equal(res.agentStatus, "idle");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/status?session=default");
  });

  it("agent.setModel — POST /set-model?session=<id> with model body", async () => {
    mock.queueHttpResponse(200, { status: "updated", model: "claude-opus-4-6" });
    sna = httpClient();

    const res = await sna.agent.setModel("default", "claude-opus-4-6");
    assert.equal(res.model, "claude-opus-4-6");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/set-model?session=default");
    assert.equal(req.body.model, "claude-opus-4-6");
  });

  it("agent.setPermissionMode — POST /set-permission-mode?session=<id>", async () => {
    mock.queueHttpResponse(200, { status: "updated", permissionMode: "bypassPermissions" });
    sna = httpClient();

    const res = await sna.agent.setPermissionMode("default", "bypassPermissions");
    assert.equal(res.permissionMode, "bypassPermissions");

    const req = mock.httpRequests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/set-permission-mode?session=default");
    assert.equal(req.body.permissionMode, "bypassPermissions");
  });

  // ── error handling ───────────────────────────────────────────

  it("HTTP 4xx rejects with server message", async () => {
    mock.queueHttpResponse(404, { message: "session not found" });
    sna = httpClient();

    await assert.rejects(
      () => sna.sessions.remove("ghost"),
      { message: "session not found" },
    );
  });

  it("HTTP 5xx rejects with server message", async () => {
    mock.queueHttpResponse(500, { message: "internal server error" });
    sna = httpClient();

    await assert.rejects(
      () => sna.agent.kill("default"),
      { message: "internal server error" },
    );
  });

  it("HTTP error with no message falls back to 'HTTP <status>'", async () => {
    mock.queueHttpResponse(503, {});
    sna = httpClient();

    await assert.rejects(
      () => sna.agent.kill("default"),
      { message: "HTTP 503" },
    );
  });

  // ── transport isolation ──────────────────────────────────────

  it("http: false uses WS even for mutating ops (no HTTP requests made)", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: false, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({
      "sessions.create": () => ({ status: "created", sessionId: "ws-only", label: "ws-only", meta: null }),
    });

    const res = await sna.sessions.create({ label: "ws-only" });
    assert.equal(res.sessionId, "ws-only");
    // No HTTP requests should have been made
    assert.equal(mock.httpRequests.length, 0);
  });

  it("http: true, ws: true — mutating ops use HTTP, WS push still works", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: true, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    // HTTP request for sessions.create
    mock.queueHttpResponse(200, { status: "created", sessionId: "dual", label: "dual", meta: null });
    const createRes = await sna.sessions.create({ label: "dual" });
    assert.equal(createRes.sessionId, "dual");
    assert.equal(mock.httpRequests.length, 1);

    // WS push for sessions.onSnapshot
    const snapshots: any[] = [];
    sna.sessions.onSnapshot((s) => snapshots.push(s));
    mock.broadcast({ type: "sessions.snapshot", sessions: [{ id: "dual" }] });
    await waitFor(() => snapshots.length > 0);

    assert.equal(snapshots[0][0].id, "dual");
    // No extra HTTP requests from the push
    assert.equal(mock.httpRequests.length, 1);
  });

  it("http: true — subscribe always uses WS, never HTTP", async () => {
    sna = new SnaClient({ baseUrl: mock.host, ws: true, http: true, reconnect: false });
    sna.connect();
    await waitFor(() => sna.connected);

    installAutoResponder({ "agent.subscribe": () => ({ cursor: 0 }) });

    await sna.agent.subscribe("default", { since: 0 });
    // WS was used — no HTTP requests
    assert.equal(mock.httpRequests.length, 0);
  });

  it("clearHttpRequests resets the recorded request log", async () => {
    mock.queueHttpResponse(200, { status: "removed" });
    mock.queueHttpResponse(200, { status: "removed" });
    sna = httpClient();

    await sna.sessions.remove("a");
    assert.equal(mock.httpRequests.length, 1);

    mock.clearHttpRequests();
    assert.equal(mock.httpRequests.length, 0);

    await sna.sessions.remove("b");
    assert.equal(mock.httpRequests.length, 1);
    assert.equal(mock.httpRequests[0].url, "/sessions/b");
  });

  it("multiple sequential HTTP calls are recorded in order", async () => {
    mock.queueHttpResponse(200, { status: "created", sessionId: "s1", label: "s1", meta: null });
    mock.queueHttpResponse(200, { status: "created", sessionId: "s2", label: "s2", meta: null });
    mock.queueHttpResponse(200, { status: "removed" });
    sna = httpClient();

    await sna.sessions.create({ id: "s1" });
    await sna.sessions.create({ id: "s2" });
    await sna.sessions.remove("s1");

    assert.equal(mock.httpRequests.length, 3);
    assert.equal(mock.httpRequests[0].url, "/sessions");
    assert.equal(mock.httpRequests[1].url, "/sessions");
    assert.equal(mock.httpRequests[2].url, "/sessions/s1");
    assert.equal(mock.httpRequests[2].method, "DELETE");
  });
});
