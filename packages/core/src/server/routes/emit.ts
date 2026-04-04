/**
 * POST /emit
 *
 * Write a skill event to SQLite and broadcast to WS subscribers.
 * Body: { skill, type, message, data?, session_id? }
 */

import type { Context } from "hono";
import { getDb } from "../../db/schema.js";
import type { SessionManager } from "../session-manager.js";
import { httpJson } from "../api-types.js";

/**
 * Create an emit route handler that broadcasts to WS subscribers.
 */
export function createEmitRoute(sessionManager: SessionManager) {
  return async (c: Context) => {
    const body = await c.req.json();
    const { skill, message, data } = body;

    // Accept both `type` (HTTP canonical) and `eventType` (WS canonical).
    // WS cannot use `type` in the message body because it is reserved as the
    // WS protocol routing field, so WS clients send `eventType` instead.
    const type = body.type ?? body.eventType;

    // Accept session from query string (?session=) for HTTP-style consistency,
    // with fallback to body fields `session_id` (legacy) or `session` (WS-style).
    const session_id = c.req.query("session") ?? body.session_id ?? body.session ?? null;

    if (!skill || !type || !message) {
      return c.json({ error: "missing fields" }, 400);
    }

    const db = getDb();
    const result = db.prepare(
      `INSERT INTO skill_events (session_id, skill, type, message, data) VALUES (?, ?, ?, ?, ?)`
    ).run(session_id, skill, type, message, data ?? null);

    const id = Number(result.lastInsertRowid);

    // Broadcast to WS subscribers
    sessionManager.broadcastSkillEvent({
      id,
      session_id: session_id ?? null,
      skill,
      type,
      message,
      data: data ?? null,
      created_at: new Date().toISOString(),
    });

    return httpJson(c, "emit", { id });
  };
}

/**
 * Legacy plain handler (no broadcast). Kept for backward compatibility
 * when consumers import emitRoute directly without SessionManager.
 */
export async function emitRoute(c: Context) {
  const { skill, type, message, data } = await c.req.json();

  if (!skill || !type || !message) {
    return c.json({ error: "missing fields" }, 400);
  }

  const db = getDb();
  const result = db.prepare(
    `INSERT INTO skill_events (skill, type, message, data) VALUES (?, ?, ?, ?)`
  ).run(skill, type, message, data ?? null);

  return c.json({ id: result.lastInsertRowid });
}
