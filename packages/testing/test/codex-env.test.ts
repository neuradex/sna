import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodexMockEnv } from "../src/index.js";

describe("createCodexMockEnv", () => {
  it("creates an isolated Codex config and mock OpenAI env", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-codex-env-"));
    try {
      const result = createCodexMockEnv({
        cwd,
        openAIBaseUrl: "http://127.0.0.1:12345/",
        apiKey: "sk-codex-mock",
        model: "gpt-5.4-mini",
      });

      assert.equal(result.cwd, cwd);
      assert.equal(result.env.CODEX_HOME, result.codexHome);
      assert.equal(result.env.OPENAI_API_KEY, "sk-codex-mock");
      assert.equal(result.openAIBaseUrl, "http://127.0.0.1:12345");

      const config = fs.readFileSync(result.configFile, "utf8");
      assert.match(config, /model_provider = "mock-openai"/);
      assert.match(config, /model = "gpt-5.4-mini"/);
      assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:12345\/v1"/);
      assert.match(config, /env_key = "OPENAI_API_KEY"/);
      assert.match(config, /wire_api = "responses"/);
      assert.match(config, new RegExp(`\\[projects\\.${JSON.stringify(cwd).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`));
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("can build a clean env instead of inheriting the parent process", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-codex-env-clean-"));
    try {
      const result = createCodexMockEnv({
        cwd,
        openAIBaseUrl: "http://127.0.0.1:23456",
        inheritEnv: false,
        env: { PATH: "/bin", SECRET_SHOULD_NOT_LEAK: "x" },
      });

      assert.equal(result.env.PATH, "/bin");
      assert.equal(result.env.SECRET_SHOULD_NOT_LEAK, undefined);
      assert.equal(result.env.CODEX_HOME, result.codexHome);
      assert.equal(result.env.OPENAI_API_KEY, "sk-test-mock-sna");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
