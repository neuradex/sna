/**
 * Chat persistence routes — CRUD for chat sessions and messages.
 *
 * Routes:
 *   GET    /sessions              — list all chat sessions
 *   GET    /images/:sessionId/:filename — serve a stored image
 *   POST   /sessions              — create a chat session
 *   DELETE /sessions/:id          — delete a chat session
 *   GET    /sessions/:id/messages — get messages for a session
 *   POST   /sessions/:id/messages — add a message to a session
 *   DELETE /sessions/:id/messages — clear messages for a session
 */

import { Hono } from "hono";
import fs from "fs";
import { getDb } from "../../db/schema.js";
import { insertChatMessage } from "../../db/chat-messages.js";
import { httpJson } from "../api-types.js";
import { resolveImagePath } from "../image-store.js";

export function createChatRoutes() {
  const app = new Hono();

  // GET /sessions — list all chat sessions
  app.get("/sessions", (c) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, label, type, meta, cwd, created_at FROM chat_sessions ORDER BY created_at DESC`
      ).all() as { id: string; label: string; type: string; meta: string | null; cwd: string | null; created_at: string }[];
      const sessions = rows.map((r) => ({
        ...r,
        meta: r.meta ? JSON.parse(r.meta) : null,
      }));
      return httpJson(c, "chat.sessions.list", { sessions });
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
      chatType?: string; // WS alias: WS cannot use `type` in message body (reserved for routing)
      meta?: Record<string, unknown>;
    };
    const id = body.id ?? crypto.randomUUID().slice(0, 8);
    // Accept both `type` (HTTP canonical) and `chatType` (WS canonical).
    const sessionType = body.type ?? body.chatType ?? "background";
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR IGNORE INTO chat_sessions (id, label, type, meta) VALUES (?, ?, ?, ?)`
      ).run(id, body.label ?? id, sessionType, body.meta ? JSON.stringify(body.meta) : null);
      return httpJson(c, "chat.sessions.create", { status: "created", id, meta: body.meta ?? null });
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
      return httpJson(c, "chat.sessions.remove", { status: "deleted" });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // GET /sessions/:id/messages
  app.get("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const sinceParam = c.req.query("since");
    const limitParam = c.req.query("limit");
    try {
      const db = getDb();
      let sql = `SELECT * FROM chat_messages WHERE session_id = ?`;
      const params: (string | number)[] = [id];

      if (sinceParam) {
        sql += ` AND id > ?`;
        params.push(parseInt(sinceParam, 10));
      }

      sql += ` ORDER BY id ASC`;

      if (limitParam) {
        sql += ` LIMIT ?`;
        params.push(parseInt(limitParam, 10));
      }

      const messages = db.prepare(sql).all(...params);
      return httpJson(c, "chat.messages.list", { messages });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message, stack: e.stack }, 500);
    }
  });

  // POST /sessions/:id/messages
  app.post("/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as {
      actor?: import("../../db/schema.js").ChatActor;
      kind?: import("../../db/schema.js").ChatKind;
      content?: string;
      embeds?: Record<string, import("../../history/types.js").EmbedRecord>;
      meta?: Record<string, unknown>;
    };

    if (!body.actor || !body.kind) {
      return c.json({ status: "error", message: "actor and kind are required" }, 400);
    }

    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`)
        .run(sessionId, sessionId);
      const id = insertChatMessage(db, {
        sessionId,
        actor: body.actor,
        kind: body.kind,
        content: body.content ?? "",
        embeds: body.embeds,
        meta: body.meta,
      });
      return httpJson(c, "chat.messages.create", { status: "created", id });
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
      return httpJson(c, "chat.messages.clear", { status: "cleared" });
    } catch (e: any) {
      return c.json({ status: "error", message: e.message }, 500);
    }
  });

  // GET /images/:sessionId/:filename — serve stored image
  app.get("/images/:sessionId/:filename", (c) => {
    const sessionId = c.req.param("sessionId");
    const filename = c.req.param("filename");
    const filePath = resolveImagePath(sessionId, filename);
    if (!filePath) {
      return c.json({ status: "error", message: "Image not found" }, 404);
    }
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    };
    const contentType = mimeMap[ext ?? ""] ?? "application/octet-stream";
    const data = fs.readFileSync(filePath);
    return new Response(data, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
  });

  return app;
}
