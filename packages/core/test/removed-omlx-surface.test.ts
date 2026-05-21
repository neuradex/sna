import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProvider } from "../src/core/providers/index.js";
import { buildClaudeEnv, ClaudeCodeProvider } from "../src/core/providers/claude-code.js";
import { resetConfig } from "../src/config.js";

const SAVED_SNA_OMLX_BASE_URL = process.env.SNA_OMLX_BASE_URL;
const SAVED_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;

afterEach(() => {
  if (SAVED_SNA_OMLX_BASE_URL === undefined) delete process.env.SNA_OMLX_BASE_URL;
  else process.env.SNA_OMLX_BASE_URL = SAVED_SNA_OMLX_BASE_URL;
  if (SAVED_ANTHROPIC_BASE_URL === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = SAVED_ANTHROPIC_BASE_URL;
  resetConfig();
});

describe("removed oMLX-specific SNA surface", () => {
  it("does not register omlx as a standalone runtime alias", () => {
    assert.throws(() => getProvider("omlx"), /Unknown agent provider: omlx/);
  });

  it("does not translate legacy providerOmlxUrl into ANTHROPIC_BASE_URL", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.SNA_OMLX_BASE_URL;
    resetConfig();

    const env = buildClaudeEnv("/usr/bin/claude", {
      providerOmlxUrl: "http://localhost:11434/v1",
    } as unknown as Parameters<typeof buildClaudeEnv>[1]);

    assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  });

  it("still lets consumers route Claude explicitly through env", () => {
    delete process.env.SNA_OMLX_BASE_URL;
    resetConfig();

    const env = buildClaudeEnv("/usr/bin/claude", {
      env: {
        ANTHROPIC_BASE_URL: "http://localhost:11434",
        ANTHROPIC_API_KEY: "sk-test",
      },
    });

    assert.equal(env.ANTHROPIC_BASE_URL, "http://localhost:11434");
    assert.equal(env.ANTHROPIC_API_KEY, "sk-test");
  });

  it("ignores baseUrl on Claude model listing", async () => {
    const provider = new ClaudeCodeProvider();
    const result = await provider.listModels?.({
      baseUrl: "http://127.0.0.1:1",
      apiKey: "sk-test",
      refresh: true,
    } as any);

    assert.equal(result?.source, "static");
    assert.ok(result?.models.some((model) => model.provider === "anthropic"));
  });
});
