import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveDatabaseKey } from "../src/db/encryption.js";

describe("database encryption key resolution", () => {
  it("returns undefined when encryption is disabled", async () => {
    assert.equal(await resolveDatabaseKey(undefined, "/tmp/sna.db"), undefined);
    assert.equal(await resolveDatabaseKey({ encryption: "none" }, "/tmp/sna.db"), undefined);
  });

  it("resolves raw, env, and custom key providers", async () => {
    process.env.SNA_TEST_DB_KEY = "env-secret";
    try {
      assert.equal(
        await resolveDatabaseKey({ encryption: "sqlite-cipher", keyProvider: { type: "raw", key: "raw-secret" } }, "/tmp/sna.db"),
        "raw-secret",
      );
      assert.equal(
        await resolveDatabaseKey({ encryption: "sqlite-cipher", keyProvider: { type: "env", env: "SNA_TEST_DB_KEY" } }, "/tmp/sna.db"),
        "env-secret",
      );
      assert.equal(
        await resolveDatabaseKey({ encryption: "sqlite-cipher", keyProvider: { type: "custom", getKey: () => "custom-secret" } }, "/tmp/sna.db"),
        "custom-secret",
      );
    } finally {
      delete process.env.SNA_TEST_DB_KEY;
    }
  });

  it("creates and reuses keytar-backed keys without touching the OS keychain", async () => {
    const stored = new Map<string, string>();
    const calls: Array<{ service: string; account: string; password?: string }> = [];
    const keytar = {
      async getPassword(service: string, account: string) {
        calls.push({ service, account });
        return stored.get(`${service}:${account}`) ?? null;
      },
      async setPassword(service: string, account: string, password: string) {
        calls.push({ service, account, password });
        stored.set(`${service}:${account}`, password);
      },
    };
    const dbPath = path.join("/tmp", "sna-keytar-test", "sna.db");
    const options = { encryption: "sqlite-cipher" as const, keyProvider: { type: "keytar" as const } };

    const first = await resolveDatabaseKey(options, dbPath, { keytar });
    const second = await resolveDatabaseKey(options, dbPath, { keytar });

    assert.match(first, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(second, first);
    assert.equal([...stored.values()].length, 1);
    assert.equal(calls.filter((call) => call.password).length, 1);
    assert.equal(calls[0].service, "dev.neuradex.sna");
    assert.match(calls[0].account, /^db:[a-f0-9]{24}$/);
  });

  it("honors explicit keytar service and account", async () => {
    let saved: { service: string; account: string; password: string } | undefined;
    const keytar = {
      async getPassword() {
        return null;
      },
      async setPassword(service: string, account: string, password: string) {
        saved = { service, account, password };
      },
    };

    const key = await resolveDatabaseKey({
      encryption: "sqlite-cipher",
      keyProvider: { type: "keytar", service: "test-service", account: "test-account" },
    }, "/tmp/sna.db", { keytar });

    assert.equal(saved?.service, "test-service");
    assert.equal(saved?.account, "test-account");
    assert.equal(saved?.password, key);
  });
});
