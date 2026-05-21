import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readSseData,
  waitForRequest,
  withMockAnthropicServer,
  withMockOpenAIServer,
} from "../src/index.js";

describe("test harness helpers", () => {
  it("runs an Anthropic mock with automatic cleanup", async () => {
    let port = 0;
    const count = await withMockAnthropicServer(async (mock) => {
      port = mock.port;
      const pending = waitForRequest(mock, (request) => request.model === "claude-test");
      const res = await fetch(`http://127.0.0.1:${mock.port}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-test",
          stream: false,
          messages: [{ role: "user", content: "cleanup" }],
        }),
      });
      assert.equal(res.status, 200);
      assert.equal((await pending).model, "claude-test");
      return mock.requests.length;
    });

    assert.equal(count, 1);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/v1/messages`));
  });

  it("runs an OpenAI mock with automatic cleanup and exposes SSE parsing", async () => {
    const text = await withMockOpenAIServer({ responseText: "alpha beta" }, async (mock) => {
      const res = await fetch(`${mock.url}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.4", stream: true, input: "ignored" }),
      });
      const lines = await readSseData(res);
      return lines
        .filter((line) => line !== "[DONE]")
        .map((line) => JSON.parse(line))
        .filter((event) => event.type === "response.output_text.delta")
        .map((event) => event.delta)
        .join("");
    });

    assert.equal(text, "alpha beta");
  });

  it("times out when a request does not arrive", async () => {
    await withMockAnthropicServer(async (mock) => {
      await assert.rejects(
        waitForRequest(mock, () => true, { timeoutMs: 10, intervalMs: 1 }),
        /Timed out waiting for mock request/,
      );
    });
  });
});
