import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderAdminPage } from "../src/server/admin-ui.js";

class FakeElement {
  textContent = "";
  innerHTML = "";
  value = "";
  disabled = false;
  readonly listeners = new Map<string, (event: any) => void | Promise<void>>();

  constructor(readonly id: string) {}

  addEventListener(type: string, listener: (event: any) => void | Promise<void>) {
    this.listeners.set(type, listener);
  }

  click() {
    return this.listeners.get("click")?.({ target: this });
  }

  closest(selector: string) {
    return selector === "button[data-auth-action]" ? this : null;
  }

  get dataset(): Record<string, string> {
    return {};
  }
}

class FakeButton extends FakeElement {
  constructor(
    id: string,
    private action?: string,
    private request?: string,
  ) {
    super(id);
  }

  override get dataset(): Record<string, string> {
    return {
      ...(this.action ? { authAction: this.action } : {}),
      ...(this.request ? { requestId: this.request } : {}),
    };
  }
}

function createAdminHarness(url: string, fetchImpl: (path: string, init?: any) => Promise<any>) {
  const elements = new Map<string, FakeElement>();
  for (const id of ["token", "status", "server", "sessions", "auth-requests", "save", "clear", "refresh"]) {
    elements.set(id, id === "save" || id === "clear" || id === "refresh" ? new FakeButton(id) : new FakeElement(id));
  }
  const storage = new Map<string, string>();
  let replacedUrl = "";
  const html = renderAdminPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "admin HTML should include a script");

  const context = vm.createContext({
    URL,
    URLSearchParams,
    window: { location: { href: url } },
    location: new URL(url),
    history: {
      replaceState(_state: unknown, _title: string, next: string) {
        replacedUrl = next;
      },
    },
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    },
    document: {
      querySelector(selector: string) {
        assert.match(selector, /^#/);
        const id = selector.slice(1);
        const element = elements.get(id);
        assert.ok(element, `missing fake element ${selector}`);
        return element;
      },
    },
    fetch: fetchImpl,
  });

  vm.runInContext(script, context);
  return { elements, storage, replacedUrl: () => replacedUrl };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async json() {
      return body;
    },
  };
}

describe("admin UI browser behavior", () => {
  it("stores token fragments, strips the address bar, and loads protected panels", async () => {
    const calls: Array<{ path: string; init?: any }> = [];
    const harness = createAdminHarness("http://127.0.0.1:3099/admin#token=owner-token", async (path, init) => {
      calls.push({ path, init });
      if (path === "/health") return jsonResponse(200, { ok: true, name: "sna", version: "1" });
      if (path === "/auth/pkce/requests") return jsonResponse(200, {
        requests: [{ requestId: "req1", clientId: "client-a", displayName: "Client A", scopes: ["agent"], status: "pending" }],
      });
      if (path === "/agent/sessions") return jsonResponse(200, { sessions: [{ id: "default", state: "idle", config: { provider: "claude-code" }, cwd: "/tmp" }] });
      throw new Error(`unexpected fetch ${path}`);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(harness.storage.get("sna.admin.authToken"), "owner-token");
    assert.equal(harness.replacedUrl(), "/admin");
    assert.match(harness.elements.get("auth-requests")!.innerHTML, /Client A/);
    assert.match(harness.elements.get("sessions")!.innerHTML, /default/);
    assert.equal(calls.find((call) => call.path === "/agent/sessions")?.init.headers.Authorization, "Bearer owner-token");
  });

  it("posts approve/deny actions from the authorization request table", async () => {
    const calls: Array<{ path: string; init?: any }> = [];
    const harness = createAdminHarness("http://127.0.0.1:3099/admin#token=owner-token", async (path, init) => {
      calls.push({ path, init });
      if (path === "/health") return jsonResponse(200, { ok: true, name: "sna", version: "1" });
      if (path === "/auth/pkce/requests") return jsonResponse(200, { requests: [] });
      if (path === "/agent/sessions") return jsonResponse(200, { sessions: [] });
      if (path === "/auth/pkce/requests/req1/approve") return jsonResponse(200, { requestId: "req1", status: "approved" });
      throw new Error(`unexpected fetch ${path}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await harness.elements.get("auth-requests")!.listeners.get("click")?.({
      target: new FakeButton("approve", "approve", "req1"),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const approve = calls.find((call) => call.path === "/auth/pkce/requests/req1/approve");
    assert.equal(approve?.init.method, "POST");
    assert.equal(approve?.init.headers.Authorization, "Bearer owner-token");
  });
});
