import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { apiRequest } from "../src/api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("apiRequest", () => {
  it("uses same-origin credentials for admin cookie authentication", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ sessions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await apiRequest("/agent/sessions");

    assert.equal(captured.url, "/agent/sessions");
    assert.equal(captured.init?.credentials, "same-origin");
    assert.equal((captured.init?.headers as Record<string, string>).Authorization, undefined);
  });

  it("sends JSON request bodies for runtime settings mutations", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ status: "updated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await apiRequest("/agent/profiles/3", {
      method: "PUT",
      token: "owner-token",
      body: { runtimeId: "codex-main", config: { reasoningLevel: 3 } },
    });

    assert.equal(captured.url, "/agent/profiles/3");
    assert.equal(captured.init?.method, "PUT");
    assert.equal((captured.init?.headers as Record<string, string>).Authorization, "Bearer owner-token");
    assert.equal((captured.init?.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal(captured.init?.body, JSON.stringify({
      runtimeId: "codex-main",
      config: { reasoningLevel: 3 },
    }));
  });
});
