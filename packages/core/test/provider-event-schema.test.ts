import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentEventSchema } from "../src/core/providers/schemas.js";

describe("AgentEvent provider contract schema", () => {
  it("accepts every streamed assistant/tool event shape from AgentEvent", () => {
    const events = [
      { type: "assistant_delta", delta: "hello", index: 0, timestamp: Date.now() },
      { type: "thinking_delta", message: "reasoning", timestamp: Date.now() },
      {
        type: "tool_use_delta",
        delta: "{\"path\"",
        index: 0,
        data: { id: "toolu_1" },
        timestamp: Date.now(),
      },
    ];

    for (const event of events) {
      const parsed = AgentEventSchema.safeParse(event);
      assert.equal(parsed.success, true, `${event.type} must be part of the provider event contract`);
    }
  });
});
