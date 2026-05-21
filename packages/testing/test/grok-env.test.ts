import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGrokMockEnv } from "../src/index.js";

describe("createGrokMockEnv", () => {
  it("creates an isolated Grok env and providerOptions for mock OpenAI routing", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-grok-env-"));
    try {
      const result = createGrokMockEnv({
        cwd,
        openAIBaseUrl: "http://127.0.0.1:12345/",
        apiKey: "sk-grok-mock",
        model: "grok-build",
      });

      assert.equal(result.cwd, cwd);
      assert.equal(result.env.HOME, result.grokHome);
      assert.equal(result.env.XAI_API_KEY, "sk-grok-mock");
      assert.equal(result.openAIBaseUrl, "http://127.0.0.1:12345");
      assert.equal(result.xaiApiBaseUrl, "http://127.0.0.1:12345/v1");
      assert.equal(result.model, "grok-build");
      assert.deepEqual(result.providerOptions, {
        xaiApiBaseUrl: "http://127.0.0.1:12345/v1",
        noLeader: true,
      });

      const config = fs.readFileSync(result.configFile, "utf8");
      assert.match(config, /\[cli\]/);
      assert.match(config, /auto_update = false/);
      assert.match(config, /use_leader = false/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("can build a clean env instead of inheriting the parent process", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-grok-env-clean-"));
    try {
      const result = createGrokMockEnv({
        cwd,
        openAIBaseUrl: "http://127.0.0.1:23456",
        inheritEnv: false,
        env: { PATH: "/bin", HOME: "/tmp/home", SECRET_SHOULD_NOT_LEAK: "x" },
      });

      assert.equal(result.env.PATH, "/bin");
      assert.equal(result.env.SECRET_SHOULD_NOT_LEAK, undefined);
      assert.equal(result.env.HOME, result.grokHome);
      assert.equal(result.env.XAI_API_KEY, "sk-test-mock-sna");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
