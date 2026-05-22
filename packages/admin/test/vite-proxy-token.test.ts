import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAdminProxyToken } from "../vite-proxy-token.js";

describe("admin Vite proxy token", () => {
  it("prefers the explicit dev proxy token", () => {
    assert.equal(
      resolveAdminProxyToken({
        SNA_ADMIN_PROXY_TOKEN: " proxy-token ",
        SNA_AUTH_TOKEN: "owner-token",
      }),
      "proxy-token",
    );
  });

  it("can read a token from an explicit token path", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-admin-token-"));
    const tokenPath = path.join(cwd, "token");
    fs.writeFileSync(tokenPath, "file-token\n");

    assert.equal(
      resolveAdminProxyToken({ SNA_ADMIN_PROXY_TOKEN_PATH: "token" }, cwd),
      "file-token",
    );
  });

  it("falls back to SNA_AUTH_TOKEN before inferred token files", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-admin-token-"));
    const daemonDir = path.join(cwd, ".sna", "local", ".sna");
    fs.mkdirSync(daemonDir, { recursive: true });
    fs.writeFileSync(path.join(daemonDir, "sna-api.token"), "stale-file-token\n");

    assert.equal(
      resolveAdminProxyToken({
        SNA_AUTH_TOKEN: "owner-token",
        SNA_DB_PATH: ".sna/local/sna.db",
      }, cwd),
      "owner-token",
    );
  });

  it("can infer the daemon token path from SNA_DB_PATH", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sna-admin-token-"));
    const daemonDir = path.join(cwd, ".sna", "local", ".sna");
    fs.mkdirSync(daemonDir, { recursive: true });
    fs.writeFileSync(path.join(daemonDir, "sna-api.token"), "daemon-token\n");

    assert.equal(
      resolveAdminProxyToken({ SNA_DB_PATH: ".sna/local/sna.db" }, cwd),
      "daemon-token",
    );
  });
});
