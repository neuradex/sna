import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startSnaDaemon } from "../src/electron/index.js";

const tempDirs: string[] = [];
const handles: Array<{ stop(): Promise<boolean> }> = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFakeServerScript(dir: string): string {
  const script = path.join(dir, "fake-sna-server.mjs");
  fs.writeFileSync(script, `
import http from "node:http";

const port = Number(process.env.SNA_PORT);
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      name: "sna",
      supervised: process.env.SNA_SUPERVISED ?? null,
    }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log("API server ready at http://localhost:" + port);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
`);
  return script;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("condition was not met before timeout");
}

afterEach(async () => {
  for (const handle of handles.splice(0).reverse()) {
    try { await handle.stop(); } catch { /* ignore cleanup failures */ }
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SNA daemon launcher", () => {
  it("starts a background server, writes daemon files, reports health, and stops it", async () => {
    const dir = makeTempDir("sna-daemon-");
    const serverScript = writeFakeServerScript(dir);
    const port = await getFreePort();

    const handle = await startSnaDaemon({
      port,
      dbPath: path.join(dir, "sna.db"),
      daemonDir: path.join(dir, ".sna"),
      serverScript,
      readyTimeout: 5_000,
      autoRestart: false,
    });
    handles.push(handle);

    assert.equal(handle.port, port);
    assert.equal(handle.adopted, false);
    assert.ok(handle.pid && handle.pid > 0);
    assert.equal(fs.existsSync(handle.pidPath), true);
    assert.equal(fs.readFileSync(handle.pidPath, "utf8").trim(), String(handle.pid));
    assert.equal(fs.existsSync(handle.logPath), true);

    const status = await handle.status();
    assert.equal(status.state, "running");
    assert.equal(status.health?.ok, true);
    assert.equal(status.health?.name, "sna");
    assert.equal(status.health?.supervised, "daemon");

    await waitFor(() => fs.readFileSync(handle.logPath, "utf8").includes("API server ready"));

    assert.equal(await handle.stop(), true);
    handles.pop();

    const stopped = await handle.status();
    assert.equal(stopped.state, "stopped");
    assert.equal(fs.existsSync(handle.pidPath), false);
  });

  it("adopts an already-running SNA daemon without owning its process", async () => {
    const dir = makeTempDir("sna-daemon-adopt-");
    const serverScript = writeFakeServerScript(dir);
    const port = await getFreePort();
    const daemonDir = path.join(dir, ".sna");

    const owner = await startSnaDaemon({
      port,
      dbPath: path.join(dir, "sna.db"),
      daemonDir,
      serverScript,
      readyTimeout: 5_000,
      autoRestart: false,
    });
    handles.push(owner);

    const adopted = await startSnaDaemon({
      port,
      dbPath: path.join(dir, "sna.db"),
      daemonDir,
      serverScript,
      readyTimeout: 5_000,
      autoRestart: false,
    });
    handles.push(adopted);

    assert.equal(adopted.adopted, true);
    assert.equal(adopted.pid, owner.pid);
    assert.equal((await adopted.status()).state, "running");

    assert.equal(await adopted.stop(), false);
    handles.pop();
    assert.equal((await owner.status()).state, "running");

    assert.equal(await owner.stop(), true);
    handles.pop();
  });
});
