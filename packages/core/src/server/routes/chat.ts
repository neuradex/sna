/**
 * Chat persistence routes — CRUD for chat sessions and messages.
 *
 * Routes:
 *   GET    /sessions              — list all chat sessions
 *   POST   /sessions              — create a chat session
 *   DELETE /sessions/:id          — delete a chat session
 *   GET    /sessions/:id/messages — get messages for a session
 *   POST   /sessions/:id/messages — add a message to a session
 *   DELETE /sessions/:id/messages — clear messages for a session
 */

import { Hono } from "hono";
import { getDb } from "../../db/schema.js";

export function createChatRoutes() {
  const app = new Hono();

  // GET /sessions — list all chat sessions
  app.get("/sessions", (c) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, type, meta, created_at FROM chat_sessions ORDER BY created_at DESC`
      ).all() as { id: string; label: string; type: string; meta: string | null; created_at: string }[];
      const sessions = rows.map((r) => ({
        ...r,
        meta: r.meta ? JSON.parse(r.meta) : null,
      }));
      return c.json({ sessions });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  });

  // POST /sessions — create a chat session
  app.post("/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: string;
      label?: string;
      type?: string;
      meta?: Record<string, unknown>;
    };
    const id = body.id ?? crypto.randomUUID().slice(0, 8);
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`
      ).run(id, body.label ?? id, body.type ?? "background", body.meta ? JSON.stringify(body.meta) : null);
      return c.json({ status: "created", id, meta: body.meta ?? null });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // DELETE /sessions/:id
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot delete default session" }, 400);
    }
    try {
      const db = getDb();
      db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
      return c.json({ status: "deleted" });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // GET /sessions/:id/messages
  app.get("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const sinceParam = c.req.query("since");
    try {
      const db = getDb();
      const query = sinceParam
        ? db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`)
        : db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`);
      const messages = sinceParam ? query.all(id, parseInt(sinceParam, 10)) : query.all(id);
      return c.json({ messages });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  });

  // POST /sessions/:id/messages
  app.post("/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as {
      role: string;
      content?: string;
      skill_name?: string;
      meta?: Record<string, unknown>;
    };

    if (!body.role) {
      return c.json({ status: "error", message: "role is required" }, 400);
    }

    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(sessionId, sessionId);
      const result = db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, skill_name, meta) VALUES (?, ?, ?, ?, ?)`
      ).run(
        sessionId,
        body.role,
        body.content ?? "",
        body.skill_name ?? null,
        body.meta ? JSON.stringify(body.meta) : null,
      );
      return c.json({ status: "created", id: result.lastInsertRowid });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // DELETE /sessions/:id/messages — clear all messages in a session
  app.delete("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    try {
      const db = getDb();
      db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
      return c.json({ status: "cleared" });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  return app;
}
