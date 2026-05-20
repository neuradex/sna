import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { useChatStore, type ChatMessage } from "../src/stores/chat-store.js";

type FetchRequest = {
  url: string;
  method: string;
  body?: unknown;
};

const originalFetch = globalThis.fetch;

function emptySession() {
  return { messages: [] as ChatMessage[], processedEventIds: new Set<number>() };
}

function resetStore() {
  useChatStore.setState({
    isOpen: false,
    width: 380,
    activeSessionId: "default",
    sessions: { default: emptySession() },
    _apiUrl: "",
    _hydratedSessions: new Set<string>(),
  });
}

function installFetch(responses: unknown[]) {
  const requests: FetchRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const body = responses.shift() ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetStore();
});

describe("useChatStore", () => {
  it("manages panel open state and clamps desktop width", () => {
    resetStore();

    useChatStore.getState().setOpen(true);
    assert.equal(useChatStore.getState().isOpen, true);

    useChatStore.getState().toggle();
    assert.equal(useChatStore.getState().isOpen, false);

    useChatStore.getState().setWidth(100);
    assert.equal(useChatStore.getState().width, 320);
    useChatStore.getState().setWidth(900);
    assert.equal(useChatStore.getState().width, 520);
    useChatStore.getState().setWidth(420);
    assert.equal(useChatStore.getState().width, 420);
  });

  it("creates, switches, and removes local sessions while mirroring server session changes", () => {
    resetStore();
    const requests = installFetch([]);
    useChatStore.getState()._setApiUrl("http://localhost:3099");

    useChatStore.getState().initSession("work");
    assert.ok(useChatStore.getState().sessions.work);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "http://localhost:3099/chat/sessions");
    assert.deepEqual(requests[0].body, { id: "work", label: "work", type: "background" });

    useChatStore.getState().setActiveSession("work");
    assert.equal(useChatStore.getState().activeSessionId, "work");

    useChatStore.getState().removeSession("default");
    assert.ok(useChatStore.getState().sessions.default);

    useChatStore.getState().removeSession("work");
    assert.equal(useChatStore.getState().activeSessionId, "default");
    assert.equal(useChatStore.getState().sessions.work, undefined);
    const deleteRequest = requests.find((request) => request.method === "DELETE");
    assert.equal(deleteRequest?.url, "http://localhost:3099/chat/sessions/work");
  });

  it("deduplicates processed event cursors per session", () => {
    resetStore();
    useChatStore.getState().initSession("s1");

    assert.equal(useChatStore.getState().markEventProcessed(10, "s1"), true);
    assert.equal(useChatStore.getState().markEventProcessed(10, "s1"), false);
    assert.equal(useChatStore.getState().markEventProcessed(10, "default"), true);
  });

  it("clears messages locally and requests server-side message deletion", () => {
    resetStore();
    const requests = installFetch([]);
    useChatStore.getState()._setApiUrl("http://localhost:3099");
    useChatStore.getState().initSession("s1");
    useChatStore.getState().addMessage({ role: "user", content: "hello" }, "s1");
    assert.equal(useChatStore.getState().sessions.s1.messages.length, 1);

    useChatStore.getState().clearMessages("s1");

    assert.equal(useChatStore.getState().sessions.s1.messages.length, 0);
    assert.equal(requests.at(-1)?.method, "DELETE");
    assert.equal(requests.at(-1)?.url, "http://localhost:3099/chat/sessions/s1/messages");
  });

  it("hydrates session metadata and lazy-fetches only the active session messages", async () => {
    resetStore();
    const requests = installFetch([
      { sessions: [{ id: "default", label: "Default", type: "main" }, { id: "work", label: "Work", type: "background" }] },
      { messages: [{ id: 1, actor: "user", kind: "text", content: "hello", meta: null, created_at: "2026-01-01T00:00:00.000Z" }] },
    ]);
    useChatStore.getState()._setApiUrl("http://localhost:3099");

    await useChatStore.getState().hydrate();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(useChatStore.getState().sessions.default);
    assert.ok(useChatStore.getState().sessions.work);
    assert.equal(useChatStore.getState().sessions.default.messages[0].role, "user");
    assert.equal(requests[0].url, "http://localhost:3099/chat/sessions");
    assert.equal(requests[1].url, "http://localhost:3099/chat/sessions/default/messages");
  });

  it("maps persisted actor/kind rows into documented UI roles and avoids duplicate fetches", async () => {
    resetStore();
    const requests = installFetch([
      {
        messages: [
          { id: 1, actor: "assistant", kind: "text", content: "answer", meta: JSON.stringify({ model: "m" }), created_at: "2026-01-01T00:00:00.000Z" },
          { id: 2, actor: "assistant", kind: "thinking", content: "plan", meta: null, created_at: "2026-01-01T00:00:01.000Z" },
          { id: 3, actor: "assistant", kind: "tool_use", content: "Read", meta: null, created_at: "2026-01-01T00:00:02.000Z" },
          { id: 4, actor: "system", kind: "tool_result", content: "ok", meta: null, created_at: "2026-01-01T00:00:03.000Z" },
          { id: 5, actor: "system", kind: "error", content: "bad", meta: null, created_at: "2026-01-01T00:00:04.000Z" },
          { id: 6, actor: "system", kind: "status", content: "done", meta: null, created_at: "2026-01-01T00:00:05.000Z" },
        ],
      },
    ]);
    useChatStore.getState().initSession("s1");
    useChatStore.getState()._setApiUrl("http://localhost:3099");

    await useChatStore.getState().fetchSessionMessages("s1");
    await useChatStore.getState().fetchSessionMessages("s1");

    assert.deepEqual(
      useChatStore.getState().sessions.s1.messages.map((message) => message.role),
      ["assistant", "thinking", "tool", "tool_result", "error", "status"],
    );
    assert.deepEqual(useChatStore.getState().sessions.s1.messages[0].meta, { model: "m" });
    assert.equal(requests.filter((request) => request.url.endsWith("/messages")).length, 1);
  });
});
