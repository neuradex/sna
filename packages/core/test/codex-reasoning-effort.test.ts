/**
 * CodexProvider — verify reasoningLevel translates to turn/start.effort
 * for the pool path, plus providerOptions.serviceTier flows to
 * turn/start.serviceTier. Uses the mock codex app-server to capture
 * the outbound JSON-RPC params.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CodexProvider } from "../src/core/providers/codex.js";
import type { AgentEvent } from "../src/core/providers/types.js";
import { getRuntimePool } from "../src/core/providers/runtime.js";
import { startMockCodexAppServer, type MockCodexServer } from "./mock-codex-app-server.js";

async function waitFor(fn: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("CodexProvider — reasoningLevel + serviceTier → turn/start", () => {
  let mock: MockCodexServer;
  const origCodexCmd = process.env.SNA_CODEX_COMMAND;

  before(() => {
    mock = startMockCodexAppServer();
    process.env.SNA_CODEX_COMMAND = mock.command;
  });

  after(() => {
    if (origCodexCmd === undefined) delete process.env.SNA_CODEX_COMMAND;
    else process.env.SNA_CODEX_COMMAND = origCodexCmd;
    mock.close();
    try { getRuntimePool().dispose(); } catch {}
  });

  beforeEach(() => mock.reset());

  it("sends effort: 'minimal' on turn/start when reasoningLevel=1", async () => {
    const provider = new CodexProvider();
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
      reasoningLevel: 1,
    });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const turnStarts = mock.requestsFor("turn/start");
    assert.ok(turnStarts.length >= 1, "expected at least one turn/start request");
    assert.equal(turnStarts[0]?.params?.effort, "minimal");
  });

  it("sends effort: 'xhigh' when reasoningLevel=5 (maximum)", async () => {
    const provider = new CodexProvider();
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
      reasoningLevel: 5,
    });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const [first] = mock.requestsFor("turn/start");
    assert.equal(first?.params?.effort, "xhigh");
  });

  it("omits effort field when reasoningLevel is unset", async () => {
    const provider = new CodexProvider();
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
    });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const [first] = mock.requestsFor("turn/start");
    assert.equal(first?.params?.effort, undefined);
  });

  it("forwards providerOptions.serviceTier to turn/start.serviceTier", async () => {
    const provider = new CodexProvider();
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
      providerOptions: { serviceTier: "priority" },
    });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const [first] = mock.requestsFor("turn/start");
    assert.equal(first?.params?.serviceTier, "priority");
  });

  it("omits serviceTier when providerOptions does not set it", async () => {
    const provider = new CodexProvider();
    const proc = provider.spawn({
      cwd: process.cwd(),
      prompt: "hi",
    });
    const events: AgentEvent[] = [];
    proc.on("event", (e) => events.push(e));

    await waitFor(() => events.some((e) => e.type === "complete"));
    proc.kill();

    const [first] = mock.requestsFor("turn/start");
    assert.equal(first?.params?.serviceTier, undefined);
  });
});
