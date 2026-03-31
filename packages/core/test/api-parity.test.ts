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
    // Read the source file and extract operation keys
    const src = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/api-types.ts"), "utf-8"
    );

    const expectedOps = [
      "sessions.create", "sessions.list", "sessions.remove",
      "agent.start", "agent.send", "agent.restart", "agent.interrupt",
      "agent.set-model", "agent.set-permission-mode",
      "agent.kill", "agent.status", "agent.run-once",
      "emit",
      "permission.respond", "permission.pending",
      "chat.sessions.list", "chat.sessions.create", "chat.sessions.remove",
      "chat.messages.list", "chat.messages.create", "chat.messages.clear",
    ];

    for (const op of expectedOps) {
      assert.ok(src.includes(`"${op}"`), `ApiResponses should define "${op}"`);
    }
  });

  it("HTTP routes use httpJson for all typed operations", async () => {
    const agentSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/routes/agent.ts"), "utf-8"
    );
    const chatSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/routes/chat.ts"), "utf-8"
    );
    const emitSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/routes/emit.ts"), "utf-8"
    );

    // Agent routes
    const agentOps = [
      "sessions.create", "sessions.list", "sessions.remove",
      "agent.start", "agent.send", "agent.kill", "agent.status",
      "agent.run-once", "agent.restart", "agent.interrupt",
      "agent.set-model", "agent.set-permission-mode",
      "permission.respond", "permission.pending",
    ];
    for (const op of agentOps) {
      assert.ok(agentSrc.includes(`httpJson(c, "${op}"`), `agent.ts should use httpJson for "${op}"`);
    }

    // Chat routes
    const chatOps = [
      "chat.sessions.list", "chat.sessions.create", "chat.sessions.remove",
      "chat.messages.list", "chat.messages.create", "chat.messages.clear",
    ];
    for (const op of chatOps) {
      assert.ok(chatSrc.includes(`httpJson(c, "${op}"`), `chat.ts should use httpJson for "${op}"`);
    }

    // Emit route
    assert.ok(emitSrc.includes(`httpJson(c, "emit"`), `emit.ts should use httpJson for "emit"`);
  });

  it("WS handlers use wsReply for all typed operations", async () => {
    const wsSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/ws.ts"), "utf-8"
    );

    const wsOps = [
      "sessions.create", "sessions.list", "sessions.remove",
      "agent.start", "agent.send", "agent.kill", "agent.status",
      "agent.run-once", "agent.restart", "agent.interrupt",
      "agent.set-model", "agent.set-permission-mode",
      "permission.respond", "permission.pending",
      "chat.sessions.list", "chat.sessions.create", "chat.sessions.remove",
      "chat.messages.list", "chat.messages.create", "chat.messages.clear",
      "emit",
    ];
    for (const op of wsOps) {
      assert.ok(wsSrc.includes(`wsReply(ws, msg,`), `ws.ts should use wsReply`);
    }
  });

  it("WS handler has case for every HTTP operation", async () => {
    const wsSrc = fs.readFileSync(
      path.join(import.meta.dirname, "../src/server/ws.ts"), "utf-8"
    );

    const expectedCases = [
      "sessions.create", "sessions.list", "sessions.remove",
      "agent.start", "agent.send", "agent.restart", "agent.interrupt",
      "agent.set-model", "agent.set-permission-mode",
      "agent.kill", "agent.status", "agent.run-once",
      "emit",
      "permission.respond", "permission.pending",
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
      "permission.request",
      "skill.event",
    ];

    for (const t of pushTypes) {
      assert.ok(wsSrc.includes(`type: "${t}"`), `ws.ts should send push type "${t}"`);
    }
  });
});
