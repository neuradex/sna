import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runtimePathsToEnv,
  startSnaServerInProcess,
} from "../src/electron/index.js";
import { DEFAULT_CURSOR_COMMAND, resolveCursorPath } from "../src/core/providers/cursor.js";
import { resetConfig } from "../src/config.js";
import { resetDb } from "../src/db/schema.js";

const ENV_KEYS = [
  "SNA_CLAUDE_COMMAND",
  "SNA_CODEX_COMMAND",
  "SNA_OPENCODE_COMMAND",
  "SNA_GROK_COMMAND",
  "SNA_CURSOR_COMMAND",
  "SNA_APP_ID",
  "SNA_PORT",
  "SNA_HOST",
  "SNA_AUTH_TOKEN",
  "SNA_ALLOWED_ORIGINS",
  "SNA_DB_PATH",
  "SNA_DATA_DIR",
  "SNA_PERMISSION_MODE",
  "SNA_MODEL",
  "SNA_PERMISSION_TIMEOUT_MS",
  "SNA_SQLITE_NATIVE_BINDING",
  "SNA_MODULES_PATH",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const tempDirs: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  resetDb();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime path registration", () => {
  it("uses cursor-agent as the Cursor default command name", () => {
    assert.equal(DEFAULT_CURSOR_COMMAND, "cursor-agent");
    assert.equal(resolveCursorPath(process.cwd(), {
      env: {},
      candidates: [],
      isExecutable: () => false,
    }), "cursor-agent");
  });

  it("maps launcher runtimePaths to provider command env vars", () => {
    assert.deepEqual(runtimePathsToEnv({
      claudeCode: "/bin/claude",
      codex: "/bin/codex",
      opencode: "/bin/opencode",
      grok: "/bin/grok",
      cursor: "/bin/cursor-agent",
    }), {
      SNA_CLAUDE_COMMAND: "/bin/claude",
      SNA_CODEX_COMMAND: "/bin/codex",
      SNA_OPENCODE_COMMAND: "/bin/opencode",
      SNA_GROK_COMMAND: "/bin/grok",
      SNA_CURSOR_COMMAND: "/bin/cursor-agent",
    });
  });

  it("applies runtimePaths in in-process launcher and lets env override them", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-runtime-paths-"));
    tempDirs.push(dir);

    const handle = await startSnaServerInProcess({
      port: 0,
      dbPath: path.join(dir, "sna.db"),
      logLevel: "silent",
      runtimePaths: {
        claudeCode: "/runtime/claude",
        codex: "/runtime/codex",
        opencode: "/runtime/opencode",
        grok: "/runtime/grok",
        cursor: "/runtime/cursor-agent",
      },
      env: {
        SNA_CLAUDE_COMMAND: "/env/claude",
      },
    });

    try {
      assert.equal(process.env.SNA_CLAUDE_COMMAND, "/env/claude");
      assert.equal(process.env.SNA_CODEX_COMMAND, "/runtime/codex");
      assert.equal(process.env.SNA_OPENCODE_COMMAND, "/runtime/opencode");
      assert.equal(process.env.SNA_GROK_COMMAND, "/runtime/grok");
      assert.equal(process.env.SNA_CURSOR_COMMAND, "/runtime/cursor-agent");
    } finally {
      await handle.stop();
    }
  });

  it("keeps launcher-owned identity and auth values authoritative", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-launcher-identity-"));
    tempDirs.push(dir);

    const handle = await startSnaServerInProcess({
      port: 0,
      dbPath: path.join(dir, "sna.db"),
      appId: "test-host",
      authToken: "launcher-token",
      allowedOrigins: ["http://localhost:5173"],
      logLevel: "silent",
      env: {
        SNA_APP_ID: "wrong-app",
        SNA_AUTH_TOKEN: "wrong-token",
        SNA_ALLOWED_ORIGINS: "https://wrong.example",
      },
    });

    try {
      assert.equal(handle.appId, "test-host");
      assert.equal(handle.authToken, "launcher-token");
      assert.deepEqual(handle.connection, {
        baseUrl: handle.baseUrl,
        authToken: "launcher-token",
      });
      assert.equal(process.env.SNA_APP_ID, "test-host");
      assert.equal(process.env.SNA_AUTH_TOKEN, "launcher-token");
      assert.equal(process.env.SNA_ALLOWED_ORIGINS, "http://localhost:5173");
    } finally {
      await handle.stop();
    }
  });
});
