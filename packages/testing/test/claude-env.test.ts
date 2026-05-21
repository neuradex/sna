import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClaudeMockEnv } from "../src/index.js";

describe("createClaudeMockEnv", () => {
  it("creates an isolated Claude config and mock Anthropic env", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-claude-env-"));
    try {
      const result = createClaudeMockEnv({
        cwd,
        anthropicBaseUrl: "http://127.0.0.1:12345",
        apiKey: "sk-test-custom-key",
        env: { PATH: "/bin", HOME: "/tmp/home", SHELL: "/bin/zsh", LANG: "en_US.UTF-8" },
      });

      assert.equal(result.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:12345");
      assert.equal(result.env.ANTHROPIC_API_KEY, "sk-test-custom-key");
      assert.equal(result.env.CLAUDE_CONFIG_DIR, result.configDir);
      assert.equal(result.env.PATH, "/bin");
      assert.equal(result.configFile, path.join(result.configDir, ".claude.json"));
      assert.equal(fs.existsSync(result.configFile), true);

      const config = JSON.parse(fs.readFileSync(result.configFile, "utf8"));
      assert.equal(config.hasCompletedOnboarding, true);
      assert.deepEqual(config.customApiKeyResponses.approved, ["sk-test-custom-key".slice(-20)]);
      assert.deepEqual(config.customApiKeyResponses.rejected, []);
      assert.equal(config.projects[cwd].hasTrustDialogAccepted, true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("can build a clean env instead of inheriting the parent process", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-claude-clean-env-"));
    try {
      const result = createClaudeMockEnv({
        cwd,
        anthropicBaseUrl: "http://127.0.0.1:12345",
        inheritEnv: false,
        env: { PATH: "/bin", HOME: "/tmp/home", SECRET_SHOULD_NOT_LEAK: "yes" },
        extraEnv: { LOOM_API_URL: "http://127.0.0.1:57787" },
      });

      assert.equal(result.env.PATH, "/bin");
      assert.equal(result.env.HOME, "/tmp/home");
      assert.equal(result.env.LOOM_API_URL, "http://127.0.0.1:57787");
      assert.equal("SECRET_SHOULD_NOT_LEAK" in result.env, false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
