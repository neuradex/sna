import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startMockOpenAIServer } from "../src/index.js";

async function readSseData(res: Response): Promise<string[]> {
  assert.equal(res.headers.get("content-type")?.startsWith("text/event-stream"), true);
  const raw = await res.text();
  return raw
    .split("\n\n")
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
}

describe("startMockOpenAIServer", () => {
  it("serves a configurable /v1/models catalog and records the request", async () => {
    const mock = await startMockOpenAIServer({
      models: [
        { id: "gpt-5.4", owned_by: "openai" },
        { id: "gpt-5.4-mini", owned_by: "openai" },
      ],
    });
    try {
      const res = await fetch(`${mock.url}/v1/models`, {
        headers: { Authorization: "Bearer sk-test" },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { object: string; data: Array<{ id: string }> };
      assert.equal(body.object, "list");
      assert.deepEqual(body.data.map((m) => m.id), ["gpt-5.4", "gpt-5.4-mini"]);
      assert.equal(mock.requests.length, 1);
      assert.equal(mock.requests[0].endpoint, "models");
      assert.equal(mock.requests[0].authorization, "Bearer sk-test");
    } finally {
      await mock.close();
    }
  });

  it("returns deterministic non-streaming chat completions", async () => {
    const mock = await startMockOpenAIServer();
    try {
      const res = await fetch(`${mock.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4",
          messages: [
            { role: "system", content: "Be terse." },
            { role: "user", content: [{ type: "text", text: "hello world" }] },
          ],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { choices: Array<{ message: { content: string } }>; usage: { total_tokens: number } };
      assert.equal(body.choices[0].message.content, "dlrow olleh");
      assert.ok(body.usage.total_tokens > 0);
      assert.equal(mock.requests[0].endpoint, "chat.completions");
      assert.equal(mock.requests[0].userText, "hello world");
      assert.equal(mock.requests[0].systemPromptLength, "Be terse.".length);
    } finally {
      await mock.close();
    }
  });

  it("streams chat completion deltas and terminates with [DONE]", async () => {
    const mock = await startMockOpenAIServer({ responseText: "alpha beta" });
    try {
      const res = await fetch(`${mock.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          stream: true,
          messages: [{ role: "user", content: "ignored by fixed response" }],
        }),
      });
      assert.equal(res.status, 200);
      const lines = await readSseData(res);
      assert.equal(lines.at(-1), "[DONE]");
      const chunks = lines.slice(0, -1).map((line) => JSON.parse(line));
      assert.equal(chunks[0].choices[0].delta.role, "assistant");
      assert.equal(
        chunks.map((c) => c.choices?.[0]?.delta?.content ?? "").join(""),
        "alpha beta",
      );
      assert.equal(mock.requests[0].stream, true);
    } finally {
      await mock.close();
    }
  });

  it("returns OpenAI Responses API output_text for non-streaming requests", async () => {
    const mock = await startMockOpenAIServer();
    try {
      const res = await fetch(`${mock.url}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: "ship it" }],
            },
          ],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as {
        output: Array<{ type: string; content: Array<{ type: string; text: string }> }>;
        usage: { input_tokens: number; output_tokens: number };
      };
      assert.equal(body.output[0].type, "message");
      assert.equal(body.output[0].content[0].type, "output_text");
      assert.equal(body.output[0].content[0].text, "ti pihs");
      assert.ok(body.usage.input_tokens > 0);
      assert.ok(body.usage.output_tokens > 0);
      assert.equal(mock.requests[0].endpoint, "responses");
      assert.equal(mock.requests[0].userText, "ship it");
    } finally {
      await mock.close();
    }
  });

  it("streams Responses API events with output_text deltas and completion", async () => {
    const mock = await startMockOpenAIServer({ responseText: "streamed response" });
    try {
      const res = await fetch(`${mock.url}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4",
          stream: true,
          input: "make it stream",
        }),
      });
      assert.equal(res.status, 200);
      const lines = await readSseData(res);
      assert.equal(lines.at(-1), "[DONE]");
      const events = lines.slice(0, -1).map((line) => JSON.parse(line));
      assert.ok(events.some((e) => e.type === "response.created"));
      assert.ok(events.some((e) => e.type === "response.output_text.delta"));
      assert.ok(events.some((e) => e.type === "response.completed"));
      const text = events
        .filter((e) => e.type === "response.output_text.delta")
        .map((e) => e.delta)
        .join("");
      assert.equal(text, "streamed response");
    } finally {
      await mock.close();
    }
  });

  it("supports custom responseText callbacks per endpoint", async () => {
    const mock = await startMockOpenAIServer({
      responseText: ({ endpoint, userText }) => `${endpoint}:${userText.toUpperCase()}`,
    });
    try {
      const res = await fetch(`${mock.url}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.4", input: "route me" }),
      });
      const body = await res.json() as { output_text: string };
      assert.equal(body.output_text, "responses:ROUTE ME");
    } finally {
      await mock.close();
    }
  });
});
