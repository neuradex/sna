import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snaPortRoute } from "../src/server/index.js";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

function makeContext() {
  return {
    json(body: unknown, status = 200) {
      return { body, status };
    },
  };
}

function tempCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-port-route-"));
  tempDirs.push(dir);
  process.chdir(dir);
  return dir;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("server entry exports", () => {
  it("snaPortRoute returns the discovered port from .sna/sna-api.port", () => {
    const dir = tempCwd();
    fs.mkdirSync(path.join(dir, ".sna"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".sna/sna-api.port"), "43210\n");

    const res = snaPortRoute(makeContext());

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { port: 43210 });
  });

  it("snaPortRoute returns 503 when the port file is missing", () => {
    tempCwd();

    const res = snaPortRoute(makeContext());

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { port: null, error: "SNA API not running" });
  });
});
