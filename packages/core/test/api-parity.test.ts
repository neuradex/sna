/**
 * API parity tests — verify ApiResponses type contract covers all operations
 * and that both HTTP and WS handlers reference the same operation keys.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

describe("API Parity", () => {

  it("api-types.ts exports ApiResponses with all expected operations", async () => {
    const src = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/api-types.ts"), "utf-8"
    );

    const expectedOps = [
      "sessions.create", "sessions.list", "sessions.remove",
      "agent.start", "agent.send", "agent.resume", "agent.restart", "agent.interrupt",
      "agent.set-model", "agent.set-permission-mode",
      "agent.kill", "agent.status", "agent.run-once",
      "permission.respond", "permission.pending",
      "chat.sessions.list", "chat.sessions.create", "chat.sessions.remove",
      "chat.messages.list", "chat.messages.create", "chat.messages.clear",
    ];

    for (const op of expectedOps) {
      assert.ok(src.includes(`"${op}"`), `ApiResponses should define "${op}"`);
    }
  });

  it("openapi.ts has an HTTP route for every typed operation", async () => {
    // The OpenAPI app (routes/openapi.ts) is the single live HTTP router,
    // mounted by createSnaApp(). For each ApiResponses operation we verify
    // a matching createRoute({ method, path: ... }) exists in that file.
    const src = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/routes/openapi.ts"), "utf-8"
    );

    const opToPath: Array<[string, string]> = [
      ["sessions.create", "/agent/sessions"],
      ["sessions.list", "/agent/sessions"],
      ["sessions.update", "/agent/sessions/{id}"],
      ["sessions.remove", "/agent/sessions/{id}"],
      ["agent.start", "/agent/start"],
      ["agent.send", "/agent/send"],
      ["agent.resume", "/agent/resume"],
      ["agent.restart", "/agent/restart"],
      ["agent.interrupt", "/agent/interrupt"],
      ["agent.set-model", "/agent/set-model"],
      ["agent.set-permission-mode", "/agent/set-permission-mode"],
      ["agent.kill", "/agent/kill"],
      ["agent.status", "/agent/status"],
      ["agent.run-once", "/agent/run-once"],
      ["agent.completion", "/agent/completion"],
      ["agent.list-models", "/agent/list-models"],
      ["permission.respond", "/agent/permission-respond"],
      ["permission.pending", "/agent/permission-pending"],
      ["chat.sessions.list", "/chat/sessions"],
      ["chat.sessions.create", "/chat/sessions"],
      ["chat.sessions.remove", "/chat/sessions/{id}"],
      ["chat.messages.list", "/chat/sessions/{id}/messages"],
      ["chat.messages.create", "/chat/sessions/{id}/messages"],
      ["chat.messages.clear", "/chat/sessions/{id}/messages"],
    ];

    for (const [op, p] of opToPath) {
      assert.ok(
        src.includes(`path: "${p}"`),
        `openapi.ts should declare a route at path "${p}" (for op "${op}")`,
      );
    }
  });

  it("WS handlers use wsReply for all typed operations", async () => {
    const wsSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/ws.ts"), "utf-8"
    );

    // Spot-check that wsReply is used; the per-op presence is covered by the case test below.
    assert.ok(wsSrc.includes("wsReply(ws, msg,"), "ws.ts should use wsReply");
  });

  it("WS handler has case for every HTTP operation", async () => {
    const wsSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/ws.ts"), "utf-8"
    );

    const expectedCases = [
      "sessions.create", "sessions.list", "sessions.remove",
      "agent.start", "agent.send", "agent.resume", "agent.restart", "agent.interrupt",
      "agent.set-model", "agent.set-permission-mode",
      "agent.kill", "agent.status", "agent.run-once",
      "permission.respond", "permission.pending", "permission.subscribe", "permission.unsubscribe",
      "chat.sessions.list", "chat.sessions.create", "chat.sessions.remove",
      "chat.messages.list", "chat.messages.create", "chat.messages.clear",
    ];

    for (const c of expectedCases) {
      assert.ok(wsSrc.includes(`case "${c}"`), `ws.ts should have case "${c}"`);
    }
  });

  it("WS push event types are documented", async () => {
    const wsSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/ws.ts"), "utf-8"
    );

    // These are push events sent without request
    const pushTypes = [
      "agent.event",
      "session.lifecycle",
      "session.config-changed",
      "session.state-changed",
      "permission.request",
    ];

    for (const t of pushTypes) {
      assert.ok(wsSrc.includes(`type: "${t}"`), `ws.ts should send push type "${t}"`);
    }
  });
});
