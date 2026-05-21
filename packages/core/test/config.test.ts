import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getConfig, resetConfig, setConfig } from "../src/config.js";

const ENV_KEYS = [
  "SNA_PORT",
  "SNA_MODEL",
  "SNA_PERMISSION_MODE",
  "SNA_MAX_SESSIONS",
  "SNA_DB_PATH",
  "SNA_DATA_DIR",
  "SNA_PERMISSION_TIMEOUT_MS",
  "SNA_OMLX_BASE_URL",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
}

afterEach(restoreEnv);

describe("SNA config helpers", () => {
  it("exposes documented defaults", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    resetConfig();

    const cfg = getConfig();
    assert.equal(cfg.port, 3099);
    assert.equal(cfg.model, "claude-sonnet-4-6");
    assert.equal(cfg.defaultProvider, "claude-code");
    assert.equal(cfg.defaultPermissionMode, "default");
    assert.equal(cfg.maxSessions, 5);
    assert.equal(cfg.maxEventBuffer, 500);
    assert.equal(cfg.permissionTimeoutMs, 0);
    assert.equal(cfg.runOnceTimeoutMs, 120_000);
    assert.equal(cfg.pollIntervalMs, 500);
    assert.equal(cfg.keepaliveIntervalMs, 15_000);
    assert.equal(cfg.skillPollMs, 2_000);
    assert.equal(cfg.dbPath, "data/sna.db");
    assert.equal(path.basename(cfg.dataDir), "data");
  });

  it("resolves documented SNA_* environment overrides", () => {
    process.env.SNA_PORT = "4567";
    process.env.SNA_MODEL = "test-model";
    process.env.SNA_PERMISSION_MODE = "plan";
    process.env.SNA_MAX_SESSIONS = "12";
    process.env.SNA_DB_PATH = "/tmp/sna-test.db";
    process.env.SNA_DATA_DIR = "/tmp/sna-data";
    process.env.SNA_PERMISSION_TIMEOUT_MS = "2500";
    process.env.SNA_OMLX_BASE_URL = "http://localhost:11434/v1";
    resetConfig();

    const cfg = getConfig();
    assert.equal(cfg.port, 4567);
    assert.equal(cfg.model, "test-model");
    assert.equal(cfg.defaultPermissionMode, "plan");
    assert.equal(cfg.maxSessions, 12);
    assert.equal(cfg.dbPath, "/tmp/sna-test.db");
    assert.equal(cfg.dataDir, "/tmp/sna-data");
    assert.equal(cfg.permissionTimeoutMs, 2500);
    assert.equal(cfg.omlxBaseUrl, "http://localhost:11434/v1");
  });

  it("setConfig merges process-local overrides and resetConfig returns to defaults plus env", () => {
    process.env.SNA_PORT = "5001";
    resetConfig();

    setConfig({ model: "override-model", maxSessions: 2 });
    assert.equal(getConfig().port, 5001);
    assert.equal(getConfig().model, "override-model");
    assert.equal(getConfig().maxSessions, 2);

    setConfig({ permissionTimeoutMs: 100 });
    assert.equal(getConfig().model, "override-model");
    assert.equal(getConfig().permissionTimeoutMs, 100);

    resetConfig();
    assert.equal(getConfig().port, 5001);
    assert.equal(getConfig().model, "claude-sonnet-4-6");
    assert.equal(getConfig().maxSessions, 5);
  });
});
