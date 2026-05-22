import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createSnaDaemonAdminUrl, startSnaDaemon } from "../src/electron/index.js";
import { startMockClaudeCli, type MockClaudeCli } from "./mock-claude-cli.js";

const require = createRequire(import.meta.url);
const tempDirs: string[] = [];
const handles: Array<{ stop(): Promise<boolean> }> = [];
const servers: http.Server[] = [];
const mockClaudeClis: MockClaudeCli[] = [];
const ALLOWED_ORIGIN = "http://localhost:5173";

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
      dbEncryption: process.env.SNA_DB_ENCRYPTION ?? null,
      dbKeyPresent: process.env.SNA_DB_KEY ? true : false,
    }));
    return;
  }
  if (req.url === "/agent/sessions") {
    if (req.headers.authorization !== "Bearer " + process.env.SNA_AUTH_TOKEN) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "error", message: "Unauthorized" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sessions: [] }));
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

async function startForeignHealthServer(port: number): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: "other-service" }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  servers.push(server);
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

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function nodeOptionsWithTsx(): string {
  const existing = process.env.NODE_OPTIONS?.trim();
  const tsxImport = `--import ${require.resolve("tsx")}`;
  if (!existing) return tsxImport;
  if (existing.includes("tsx")) return existing;
  return `${existing} ${tsxImport}`;
}

async function requestJson(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: Record<string, unknown>,
  authToken?: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

afterEach(async () => {
  for (const handle of handles.splice(0).reverse()) {
    try { await handle.stop(); } catch { /* ignore cleanup failures */ }
  }
  for (const server of servers.splice(0).reverse()) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const mock of mockClaudeClis.splice(0)) {
    mock.close();
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
    });
    handles.push(handle);

    assert.equal(handle.port, port);
    assert.equal(handle.host, "127.0.0.1");
    assert.equal(handle.appId, "sna-sdk");
    assert.equal(handle.adopted, false);
    assert.match(handle.authToken, /^sna_/);
    assert.deepEqual(handle.connection, {
      baseUrl: `http://127.0.0.1:${port}`,
      authToken: handle.authToken,
    });
    assert.equal(handle.adminUrl, `http://127.0.0.1:${port}/admin`);
    assert.equal(
      createSnaDaemonAdminUrl(handle),
      `http://127.0.0.1:${port}/admin#token=${encodeURIComponent(handle.authToken)}`,
    );
    assert.equal(createSnaDaemonAdminUrl(handle, { withToken: false }), handle.adminUrl);
    let openedUrl = "";
    assert.equal(
      await handle.openAdmin({ opener: (url) => { openedUrl = url; } }),
      createSnaDaemonAdminUrl(handle),
    );
    assert.equal(openedUrl, createSnaDaemonAdminUrl(handle));
    assert.ok(handle.pid && handle.pid > 0);
    assert.equal(fs.existsSync(handle.pidPath), true);
    assert.equal(fs.readFileSync(handle.pidPath, "utf8").trim(), String(handle.pid));
    assert.equal(fs.existsSync(handle.logPath), true);
    assert.equal(fs.readFileSync(handle.tokenPath, "utf8"), handle.authToken);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(handle.tokenPath).mode & 0o777, 0o600);
    }

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
    });
    handles.push(owner);

    const adopted = await startSnaDaemon({
      port,
      dbPath: path.join(dir, "sna.db"),
      daemonDir,
      serverScript,
      readyTimeout: 5_000,
    });
    handles.push(adopted);

    assert.equal(adopted.adopted, true);
    assert.equal(adopted.authToken, owner.authToken);
    assert.equal(adopted.pid, owner.pid);
    assert.equal((await adopted.status()).state, "running");

    assert.equal(await adopted.stop(), false);
    handles.pop();
    assert.equal((await owner.status()).state, "running");

    assert.equal(await owner.stop(), true);
    handles.pop();
  });

  it("does not adopt an SNA daemon when the configured token is rejected", async () => {
    const dir = makeTempDir("sna-daemon-token-");
    const serverScript = writeFakeServerScript(dir);
    const port = await getFreePort();
    const daemonDir = path.join(dir, ".sna");

    const owner = await startSnaDaemon({
      port,
      dbPath: path.join(dir, "sna.db"),
      daemonDir,
      serverScript,
      readyTimeout: 5_000,
    });
    handles.push(owner);

    await assert.rejects(
      startSnaDaemon({
        port,
        dbPath: path.join(dir, "sna.db"),
        daemonDir,
        authToken: "wrong-token",
        serverScript,
        readyTimeout: 500,
      }),
      /configured auth token was rejected/,
    );
  });

  it("passes encrypted database settings to the daemon process", async () => {
    const dir = makeTempDir("sna-daemon-encrypted-");
    const serverScript = writeFakeServerScript(dir);
    const port = await getFreePort();

    const handle = await startSnaDaemon({
      port,
      dbPath: path.join(dir, "sna.db"),
      daemonDir: path.join(dir, ".sna"),
      serverScript,
      readyTimeout: 5_000,
      database: {
        encryption: "sqlite-cipher",
        keyProvider: { type: "raw", key: "test-secret" },
      },
    });
    handles.push(handle);

    const status = await handle.status();
    assert.equal(status.health?.dbEncryption, "sqlite-cipher");
    assert.equal(status.health?.dbKeyPresent, true);
  });

  it("runs the real standalone daemon PKCE flow with scoped HTTP access", async () => {
    const dir = makeTempDir("sna-daemon-smoke-");
    const mockClaude = startMockClaudeCli();
    mockClaudeClis.push(mockClaude);
    const port = await getFreePort();

    const handle = await startSnaDaemon({
      port,
      dbPath: path.join(dir, "sna.db"),
      daemonDir: path.join(dir, ".sna"),
      serverScript: path.resolve(import.meta.dirname, "../src/server/standalone.ts"),
      readyTimeout: 10_000,
      allowedOrigins: [ALLOWED_ORIGIN],
      runtimePaths: { claudeCode: mockClaude.command },
      env: { NODE_OPTIONS: nodeOptionsWithTsx() },
    });
    handles.push(handle);

    const openapi = await requestJson(handle.baseUrl, "GET", "/openapi.json", undefined, handle.authToken);
    assert.equal(openapi.status, 200);
    assert.ok(openapi.body.paths["/auth/pkce/start"].post);

    const verifier = "daemon-smoke-verifier";
    const start = await requestJson(handle.baseUrl, "POST", "/auth/pkce/start", {
      clientId: "daemon-smoke-client",
      displayName: "Daemon Smoke Client",
      codeChallenge: pkceChallenge(verifier),
      codeChallengeMethod: "S256",
      scopes: ["sessions", "chat"],
    });
    assert.equal(start.status, 201);

    const approve = await requestJson(
      handle.baseUrl,
      "POST",
      `/auth/pkce/requests/${start.body.requestId}/approve`,
      {},
      handle.authToken,
    );
    assert.equal(approve.status, 200);
    assert.equal(approve.body.status, "approved");

    const token = await requestJson(handle.baseUrl, "POST", "/auth/pkce/token", {
      grantType: "authorization_code",
      requestId: start.body.requestId,
      code: approve.body.code,
      codeVerifier: verifier,
    });
    assert.equal(token.status, 200);
    assert.match(token.body.accessToken, /^sna_at_/);

    const sessions = await requestJson(handle.baseUrl, "GET", "/agent/sessions", undefined, token.body.accessToken);
    assert.equal(sessions.status, 200);
    assert.ok(Array.isArray(sessions.body.sessions));

    const chat = await requestJson(handle.baseUrl, "GET", "/chat/sessions", undefined, token.body.accessToken);
    assert.equal(chat.status, 200);
    assert.ok(Array.isArray(chat.body.sessions));

    const agentDenied = await requestJson(handle.baseUrl, "GET", "/agent/status", undefined, token.body.accessToken);
    assert.equal(agentDenied.status, 403);
    assert.match(agentDenied.body.message, /Insufficient scope.*agent/);
  });

  it("does not adopt a non-SNA service that happens to expose /health", async () => {
    const dir = makeTempDir("sna-daemon-foreign-");
    const serverScript = writeFakeServerScript(dir);
    const port = await getFreePort();
    await startForeignHealthServer(port);

    await assert.rejects(
      startSnaDaemon({
        port,
        dbPath: path.join(dir, "sna.db"),
        daemonDir: path.join(dir, ".sna"),
        serverScript,
        readyTimeout: 500,
      }),
      /already serving a non-SNA \/health endpoint/,
    );
  });
});
