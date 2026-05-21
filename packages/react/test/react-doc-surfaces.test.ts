import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { SnaContext, useSnaContext } from "../src/context.js";
import { SnaProvider } from "../src/components/sna-provider.js";
import { SnaSession } from "../src/components/sna-session.js";
import { SnaChatUI } from "../src/components/sna-chat-ui.js";
import { useAgent, type AgentEvent } from "../src/hooks/use-agent.js";
import { useResponsiveChat, type ChatMode } from "../src/hooks/use-responsive-chat.js";
import { useSessionManager, type SessionInfo } from "../src/hooks/use-session-manager.js";
import { useChatStore, type ChatMessage } from "../src/stores/chat-store.js";

type FetchRequest = {
  url: string;
  method: string;
  body?: unknown;
};

type MockResponse = unknown | ((request: FetchRequest) => unknown | Promise<unknown>);

type MockWindow = {
  innerWidth: number;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  removeEventListener: (type: string, listener: (event: any) => void) => void;
  dispatch: (type: string, event?: Record<string, unknown>) => void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const mounted = new Set<ReactTestRenderer>();

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

function installWindow(innerWidth = 1200) {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const storage = new Map<string, string>();
  const win: MockWindow = {
    innerWidth,
    addEventListener(type, listener) {
      const existing = listeners.get(type) ?? new Set();
      existing.add(listener);
      listeners.set(type, existing);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener({
          type,
          preventDefault() {},
          ...event,
        });
      }
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };

  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  return win;
}

function installFetch(responses: MockResponse[] | ((request: FetchRequest) => unknown | Promise<unknown>)) {
  const requests: FetchRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);

    const body = Array.isArray(responses)
      ? typeof responses[0] === "function"
        ? await (responses.shift() as (request: FetchRequest) => unknown | Promise<unknown>)(request)
        : responses.shift() ?? {}
      : await responses(request);

    return new Response(JSON.stringify(body ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

function installEventSource() {
  MockEventSource.instances = [];
  Object.defineProperty(globalThis, "EventSource", {
    value: MockEventSource,
    configurable: true,
  });
  return MockEventSource.instances;
}

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  mounted.add(renderer);
  await flush();
  return renderer;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function contextProvider(children: React.ReactNode, sessionId = "default") {
  return React.createElement(
    SnaContext.Provider,
    { value: { apiUrl: "http://localhost:3099", sessionId } },
    children,
  );
}

afterEach(async () => {
  for (const renderer of mounted) {
    await act(async () => {
      renderer.unmount();
    });
  }
  mounted.clear();

  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "EventSource", {
    value: originalEventSource,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: originalLocalStorage,
    configurable: true,
  });
  resetStore();
});

describe("React documented surfaces", () => {
  it("SnaProvider discovers the API URL and SnaSession scopes only the session id", async () => {
    installWindow();
    const requests = installFetch([{ port: 4242 }]);
    let providerContext: ReturnType<typeof useSnaContext> | undefined;
    let sessionContext: ReturnType<typeof useSnaContext> | undefined;

    function Capture({ slot }: { slot: "provider" | "session" }) {
      const context = useSnaContext();
      if (slot === "provider") providerContext = context;
      if (slot === "session") sessionContext = context;
      return null;
    }

    await render(React.createElement(
      SnaProvider,
      { hydrate: false },
      React.createElement(React.Fragment, null,
        React.createElement(Capture, { slot: "provider" }),
        React.createElement(SnaSession, { id: "review-panel" },
          React.createElement(Capture, { slot: "session" }),
        ),
      ),
    ));

    assert.equal(requests[0].url, "/api/sna-port");
    assert.equal(providerContext?.apiUrl, "http://localhost:4242");
    assert.equal(providerContext?.sessionId, "default");
    assert.equal(sessionContext?.apiUrl, "http://localhost:4242");
    assert.equal(sessionContext?.sessionId, "review-panel");
    assert.equal(useChatStore.getState()._apiUrl, "http://localhost:4242");
  });

  it("SnaProvider hydrates the chat store by default and can skip hydration", async () => {
    installWindow();
    const hydratedRequests = installFetch([
      { sessions: [{ id: "default", label: "Default", type: "main" }] },
      { messages: [] },
    ]);

    await render(React.createElement(
      SnaProvider,
      { snaUrl: "http://localhost:4000" },
      React.createElement("div"),
    ));

    assert.equal(hydratedRequests[0].url, "http://localhost:4000/chat/sessions");
    assert.equal(hydratedRequests[1].url, "http://localhost:4000/chat/sessions/default/messages");

    for (const renderer of mounted) {
      await act(async () => renderer.unmount());
    }
    mounted.clear();
    resetStore();

    const skippedRequests = installFetch([]);
    await render(React.createElement(
      SnaProvider,
      { snaUrl: "http://localhost:4000", hydrate: false },
      React.createElement("div"),
    ));

    assert.equal(skippedRequests.length, 0);
    assert.equal(useChatStore.getState()._apiUrl, "http://localhost:4000");
  });

  it("useResponsiveChat maps viewport widths to documented modes and reacts to resize", async () => {
    const win = installWindow(500);
    let mode: ChatMode | undefined;

    function Capture() {
      mode = useResponsiveChat().mode;
      return null;
    }

    await render(contextProvider(React.createElement(Capture)));

    assert.equal(mode, "fullscreen");

    win.innerWidth = 800;
    await act(async () => win.dispatch("resize"));
    assert.equal(mode, "overlay");

    win.innerWidth = 1024;
    await act(async () => win.dispatch("resize"));
    assert.equal(mode, "side-by-side");
  });

  it("useSessionManager calls the documented HTTP routes and updates state from refresh", async () => {
    installWindow();
    const requests = installFetch((request) => {
      if (request.method === "GET" && request.url.endsWith("/agent/sessions")) {
        return { sessions: [{ id: "default", label: "Default", type: "main" }] };
      }
      if (request.method === "POST" && request.url.endsWith("/agent/sessions")) {
        return { status: "created", sessionId: "work" };
      }
      return { status: "ok" };
    });
    let manager: ReturnType<typeof useSessionManager> | undefined;

    function Capture() {
      manager = useSessionManager(0);
      return null;
    }

    await render(contextProvider(React.createElement(Capture)));

    assert.deepEqual(
      manager?.sessions.map((session: SessionInfo) => session.id),
      ["default"],
    );

    let created: string | null = null;
    await act(async () => {
      created = await manager!.createSession({ label: "Work", cwd: "/tmp/work" });
    });
    await act(async () => {
      await manager!.killSession("work session");
    });
    await act(async () => {
      await manager!.deleteSession("work/session");
    });

    assert.equal(created, "work");
    assert.equal(requests[1].method, "POST");
    assert.equal(requests[1].url, "http://localhost:3099/agent/sessions");
    assert.deepEqual(requests[1].body, { label: "Work", cwd: "/tmp/work" });
    assert.equal(requests[3].url, "http://localhost:3099/agent/kill?session=work%20session");
    assert.equal(requests[5].url, "http://localhost:3099/agent/sessions/work%2Fsession");
    assert.equal(requests[5].method, "DELETE");
  });

  it("useAgent opens the SSE stream, dispatches filtered callbacks, and posts documented commands", async () => {
    installWindow();
    const sources = installEventSource();
    const seen: string[] = [];
    const requests = installFetch((request) => {
      if (request.url.includes("/agent/status")) return { eventCount: 7, alive: true };
      if (request.url.includes("/agent/start")) return { status: "started" };
      if (request.url.includes("/agent/send")) return { status: "sent" };
      if (request.url.includes("/agent/completion")) return { content: "done" };
      return { status: "ok" };
    });
    let agent: ReturnType<typeof useAgent> | undefined;

    function Capture() {
      agent = useAgent({
        provider: "codex",
        permissionMode: "acceptEdits",
        reasoningLevel: 2,
        providerOptions: { serviceTier: "priority" },
        onEvent: (event: AgentEvent) => seen.push(`event:${event.type}`),
        onInit: () => seen.push("init"),
        onThinking: () => seen.push("thinking"),
        onAssistant: () => seen.push("assistant"),
        onToolResult: () => seen.push("tool_result"),
        onComplete: () => seen.push("complete"),
        onError: () => seen.push("error"),
      });
      return null;
    }

    await render(contextProvider(React.createElement(Capture), "agent one"));

    assert.equal(requests[0].url, "http://localhost:3099/agent/status?session=agent%20one");
    assert.equal(sources[0].url, "http://localhost:3099/agent/events?session=agent%20one&since=7");
    assert.equal(agent?.alive, true);

    await act(async () => {
      sources[0].onopen?.({} as Event);
    });
    assert.equal(agent?.connected, true);

    for (const type of ["init", "thinking", "assistant", "tool_result", "complete", "error"] as const) {
      await act(async () => {
        sources[0].onmessage?.({
          data: JSON.stringify({ type, message: type }),
          lastEventId: "8",
        } as MessageEvent);
      });
    }

    assert.deepEqual(seen, [
      "event:init", "init",
      "event:thinking", "thinking",
      "event:assistant", "assistant",
      "event:tool_result", "tool_result",
      "event:complete", "complete",
      "event:error", "error",
    ]);

    await act(async () => {
      await agent!.start("boot");
      await agent!.send("hello");
      await agent!.completion({
        prompt: "summarize",
        reasoningLevel: 3,
        providerOptions: { serviceTier: "batch" },
      });
      await agent!.kill();
    });

    assert.equal(requests[1].url, "http://localhost:3099/agent/start?session=agent%20one");
    assert.deepEqual(requests[1].body, {
      provider: "codex",
      prompt: "boot",
      permissionMode: "acceptEdits",
      reasoningLevel: 2,
      providerOptions: { serviceTier: "priority" },
    });
    assert.equal(requests[2].url, "http://localhost:3099/agent/send?session=agent%20one");
    assert.deepEqual(requests[2].body, { message: "hello" });
    assert.equal(requests[3].url, "http://localhost:3099/agent/completion");
    assert.deepEqual(requests[3].body, {
      provider: "codex",
      reasoningLevel: 3,
      prompt: "summarize",
      providerOptions: { serviceTier: "batch" },
    });
    assert.equal(requests[4].url, "http://localhost:3099/agent/kill?session=agent%20one");
    assert.equal(requests[4].method, "POST");
    assert.equal(agent?.alive, false);
  });

  it("useAgent closes the stream and schedules the documented reconnect delay on SSE error", async () => {
    installWindow();
    const sources = installEventSource();
    installFetch((request) => request.url.includes("/agent/status")
      ? { eventCount: 0, alive: false }
      : { status: "ok" });
    let agent: ReturnType<typeof useAgent> | undefined;

    function Capture() {
      agent = useAgent();
      return null;
    }

    await render(contextProvider(React.createElement(Capture)));
    await act(async () => {
      sources[0].onopen?.({} as Event);
    });
    assert.equal(agent?.connected, true);

    const originalSetTimeout = globalThis.setTimeout;
    const scheduled: Array<{ delay?: number }> = [];
    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      scheduled.push({ delay });
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      await act(async () => {
        sources[0].onerror?.({} as Event);
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    assert.equal(sources[0].closed, true);
    assert.equal(agent?.connected, false);
    assert.deepEqual(scheduled, [{ delay: 3000 }]);
  });

  it("SnaChatUI auto-starts the agent and wires the documented keyboard toggle", async () => {
    const win = installWindow();
    installEventSource();
    const requests = installFetch((request) => {
      if (request.url.includes("/agent/status")) return { eventCount: 0, alive: false };
      if (request.url.endsWith("/agent/sessions")) return { sessions: [] };
      if (request.url.includes("/agent/start")) return { status: "started" };
      return { status: "ok" };
    });

    await render(React.createElement(
      SnaContext.Provider,
      { value: { apiUrl: "http://localhost:3099", sessionId: "chat" } },
      React.createElement(
        SnaChatUI,
        { defaultOpen: false, dangerouslySkipPermissions: true },
        React.createElement("main", null, "App"),
      ),
    ));

    const startRequest = requests.find((request) => request.url === "http://localhost:3099/agent/start?session=chat");
    assert.deepEqual(startRequest?.body, {
      provider: "claude-code",
      permissionMode: "bypassPermissions",
    });
    assert.equal(useChatStore.getState().isOpen, false);

    let prevented = false;
    await act(async () => {
      win.dispatch("keydown", {
        key: ".",
        ctrlKey: true,
        preventDefault() {
          prevented = true;
        },
      });
    });

    assert.equal(prevented, true);
    assert.equal(useChatStore.getState().isOpen, true);
  });
});
