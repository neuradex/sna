import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenCodeMockConfig } from "../src/index.js";

describe("createOpenCodeMockConfig", () => {
  it("creates an OpenCode config and providerOptions for mock-attached routing", () => {
    const result = createOpenCodeMockConfig({
      openAIBaseUrl: "http://127.0.0.1:12345/",
      apiKey: "sk-opencode-mock",
      providerId: "mock-provider",
      modelId: "mock-model",
      agent: "plan",
    });

    assert.equal(result.model, "mock-provider/mock-model");
    assert.equal(result.openAIBaseUrl, "http://127.0.0.1:12345");
    assert.equal(result.providerOptions.modelProviderId, "mock-provider");
    assert.equal(result.providerOptions.agent, "plan");
    assert.equal(typeof result.providerOptions.opencodeConfigHash, "string");
    assert.equal(result.providerOptions.opencodeConfig, result.config);

    const provider = (result.config.provider as Record<string, any>)["mock-provider"];
    assert.equal(provider.npm, "@ai-sdk/openai-compatible");
    assert.equal(provider.options.baseURL, "http://127.0.0.1:12345/v1");
    assert.equal(provider.options.apiKey, "sk-opencode-mock");
    assert.ok(provider.models["mock-model"]);

    const agents = result.config.agent as Record<string, any>;
    assert.equal(agents.plan.model, "mock-provider/mock-model");
    assert.equal(agents.plan.maxSteps, 1);
  });

  it("uses a stable hash for equivalent config objects", () => {
    const a = createOpenCodeMockConfig({
      openAIBaseUrl: "http://127.0.0.1:1",
      providerId: "p",
      modelId: "m",
    });
    const b = createOpenCodeMockConfig({
      modelId: "m",
      providerId: "p",
      openAIBaseUrl: "http://127.0.0.1:1/",
    });

    assert.equal(a.providerOptions.opencodeConfigHash, b.providerOptions.opencodeConfigHash);
  });
});
