import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CodexProvider } from "../src/core/providers/codex.js";
import { getRuntimePool } from "../src/core/providers/runtime.js";
import { startMockCodexAppServer, type MockCodexServer } from "./mock-codex-app-server.js";

async function waitFor(fn: () => boolean, timeoutMs = 2000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function startupArgs(mock: MockCodexServer): string[] {
  const startup = mock.readRequests().find((entry) => "startup" in entry) as
    | { startup?: { argv?: string[] } }
    | undefined;
  return startup?.startup?.argv ?? [];
}

describe("Codex CLI provider options", () => {
  let mock: MockCodexServer;
  const origCodexCmd = process.env.SNA_CODEX_COMMAND;

  before(() => {
    mock = startMockCodexAppServer();
    process.env.SNA_CODEX_COMMAND = mock.command;
  });

  after(() => {
    getRuntimePool().dispose();
    if (origCodexCmd === undefined) delete process.env.SNA_CODEX_COMMAND;
    else process.env.SNA_CODEX_COMMAND = origCodexCmd;
    mock.close();
  });

  beforeEach(() => {
    getRuntimePool().dispose();
    mock.reset();
  });

  it("passes Codex profile and config overrides to app-server startup", async () => {
    const provider = new CodexProvider();
    const handle = await provider.prepareRuntime({
      provider: "codex",
      cwd: process.cwd(),
      providerOptions: {
        profile: "work",
        config: {
          model_provider: "openai",
          "features.responses": "true",
        },
      },
    });
    try {
      await waitFor(() => startupArgs(mock).length > 0);
    } finally {
      handle.dispose();
    }

    assert.deepEqual(startupArgs(mock), [
      "--profile",
      "work",
      "-c",
      "model_provider=openai",
      "-c",
      "features.responses=true",
      "app-server",
    ]);
  });

  it("passes Codex profile and config overrides to codex exec", async () => {
    const provider = new CodexProvider();
    const deltas: string[] = [];

    const result = await provider.complete({
      cwd: process.cwd(),
      prompt: "say hello",
      timeout: 2000,
      onDelta: (delta) => deltas.push(delta),
      providerOptions: {
        profile: "work",
        config: {
          model_provider: "openai",
          "features.responses": "true",
        },
      },
    });

    assert.equal(result.text, "Hello world");
    assert.deepEqual(deltas, ["Hello "]);
    assert.deepEqual(startupArgs(mock).slice(0, 7), [
      "--profile",
      "work",
      "-c",
      "model_provider=openai",
      "-c",
      "features.responses=true",
      "exec",
    ]);
  });
});
