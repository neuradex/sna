/**
 * Mock Codex app-server stub.
 *
 * Codex's provider spawns `codex app-server` and speaks JSON-RPC over stdio.
 * For tests we want to verify what the provider SENDS without running the
 * real Codex binary. This stub is a Node script that:
 *   1. Reads line-delimited JSON-RPC from stdin
 *   2. Records every received request to a JSONL log file
 *   3. Sends minimal correct responses so the provider's handshake completes
 *   4. Emits a turn/completed notification after turn/start so Codex provider
 *      unblocks any pending turns
 *
 * Tests point the provider at this stub via the `SNA_CODEX_COMMAND` env var
 * (consumed by resolveCodexCli) and read the log file to assert on captured
 * RPC method+params (notably thread/resume's `history` field).
 *
 * Usage:
 *   const mock = await startMockCodexAppServer();
 *   process.env.SNA_CODEX_COMMAND = mock.command;
 *   // ... spawn provider ...
 *   const requests = mock.readRequests();
 *   // ... assert on requests ...
 *   mock.close();
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface MockCodexServer {
  /** Absolute path to the stub script — set as SNA_CODEX_COMMAND. */
  command: string;
  /** JSONL file where the stub logs every received request. */
  requestsLog: string;
  /** Parsed log snapshot. Each entry is one received JSON-RPC message. */
  readRequests(): Array<{ jsonrpc?: string; id?: number; method?: string; params?: unknown; result?: unknown }>;
  /** Extract a specific method's requests in order. */
  requestsFor(method: string): Array<{ id?: number; params?: any }>;
  /** Drop all captured requests — call at the start of each test for isolation. */
  reset(): void;
  /** Clean up temp files. */
  close(): void;
}

/**
 * The stub script source. Written to a tempfile and run via `node <path>`.
 * Keep it self-contained — no external requires — so the script is
 * effectively just plumbing.
 */
const STUB_SCRIPT = `
const fs = require("fs");

const logPath = process.env.CODEX_MOCK_LOG;
const appendLog = (obj) => {
  if (!logPath) return;
  try { fs.appendFileSync(logPath, JSON.stringify(obj) + "\\n"); } catch {}
};

const writeLine = (obj) => {
  process.stdout.write(JSON.stringify(obj) + "\\n");
};

// Thread counter — each thread/start produces a fresh id.
let threadCounter = 0;
let turnCounter = 0;

function handle(msg) {
  appendLog(msg);

  // Notifications don't need responses.
  if (msg.id == null) return;

  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      writeLine({
        jsonrpc: "2.0",
        id,
        result: {
          serverInfo: { name: "mock-codex", version: "0.0.0" },
          capabilities: { experimentalApi: true },
        },
      });
      return;

    case "experimentalFeature/enablement/set":
      writeLine({
        jsonrpc: "2.0",
        id,
        result: { enablement: params?.enablement ?? {} },
      });
      return;

    case "thread/start":
    case "thread/resume": {
      threadCounter++;
      const threadId = params?.threadId && typeof params.threadId === "string"
        ? params.threadId
        : \`mock-thread-\${threadCounter}\`;
      writeLine({
        jsonrpc: "2.0",
        id,
        result: {
          threadId,
          thread: { id: threadId },
        },
      });
      // Emit thread/started notification so the provider updates its state.
      writeLine({
        jsonrpc: "2.0",
        method: "thread/started",
        params: { thread: { id: threadId } },
      });
      return;
    }

    case "turn/start": {
      turnCounter++;
      const turnId = \`mock-turn-\${turnCounter}\`;
      writeLine({
        jsonrpc: "2.0",
        id,
        result: { turn: { id: turnId } },
      });
      // Synthesize a minimal turn completion so the provider moves past "processing".
      writeLine({
        jsonrpc: "2.0",
        method: "turn/started",
        params: { turn: { id: turnId } },
      });
      writeLine({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { turn: { id: turnId, status: "completed", durationMs: 10 } },
      });
      return;
    }

    case "turn/interrupt":
      writeLine({ jsonrpc: "2.0", id, result: {} });
      return;

    default:
      // Unknown methods get an empty success response so handshake progresses.
      writeLine({ jsonrpc: "2.0", id, result: {} });
  }
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch {}
  }
});
process.stdin.on("end", () => process.exit(0));
`;

let stubPath: string | null = null;

/** Write the stub script to a tempfile once per process. */
function ensureStubScript(): string {
  if (stubPath && fs.existsSync(stubPath)) return stubPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-codex-"));
  stubPath = path.join(dir, "mock-codex-app-server.js");
  fs.writeFileSync(stubPath, STUB_SCRIPT);
  return stubPath;
}

export function startMockCodexAppServer(): MockCodexServer {
  const script = ensureStubScript();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-codex-log-"));
  const requestsLog = path.join(logDir, "requests.jsonl");
  fs.writeFileSync(requestsLog, "");

  // `SNA_CODEX_COMMAND` is split on whitespace by validateCodexPath via `execSync`,
  // so passing a space-separated multi-word command requires the first token to
  // be a real executable. We ship a shim shell script that (a) answers
  // `--version` directly so validateCodexPath passes, (b) otherwise delegates
  // to the node stub with the request log path injected via env.
  const wrapperPath = path.join(logDir, "codex");
  fs.writeFileSync(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "--version" ]; then',
      '  echo "codex-cli mock 0.0.0"',
      "  exit 0",
      "fi",
      `exec env CODEX_MOCK_LOG="${requestsLog}" node "${script}" "$@"`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(wrapperPath, 0o755);

  return {
    command: wrapperPath,
    requestsLog,
    readRequests() {
      const raw = fs.readFileSync(requestsLog, "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    },
    requestsFor(method: string) {
      return this.readRequests().filter((r) => r.method === method);
    },
    reset() {
      fs.writeFileSync(requestsLog, "");
    },
    close() {
      try { fs.rmSync(logDir, { recursive: true, force: true }); } catch {}
    },
  };
}
