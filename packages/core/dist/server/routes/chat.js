import { Hono } from "hono";
import { getDb } from "../../db/schema.js";
function createChatRoutes() {
  const app = new Hono();
  app.get("/sessions", (c) => {
    const db = getDb();
    const sessions = db.prepare(
      `SELECT id, label, type, created_at FROM chat_sessions ORDER BY created_at DESC`
    ).all();
    return c.json({ sessions });
  });
  app.post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = body.id ?? crypto.randomUUID().slice(0, 8);
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, ?)`
    ).run(id, body.label ?? id, body.type ?? "background");
    return c.json({ status: "created", id });
  });
  app.delete("/sessions/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ status: "error", message: "Cannot delete default session" }, 400);
    }
    const db = getDb();
    db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
    return c.json({ status: "deleted" });
  });
  app.get("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const sinceParam = c.req.query("since");
    const db = getDb();
    const query = sinceParam ? db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id ASC`) : db.prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC`);
    const messages = sinceParam ? query.all(id, parseInt(sinceParam, 10)) : query.all(id);
    return c.json({ messages });
  });
  app.post("/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    if (!body.role) {
      return c.json({ status: "error", message: "role is required" }, 400);
    }
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO chat_sessions (id, label, type) VALUES (?, ?, 'main')`).run(sessionId, sessionId);
    const result = db.prepare(
      `INSERT INTO chat_messages (session_id, role, content, skill_name, meta) VALUES (?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      body.role,
      body.content ?? "",
      body.skill_name ?? null,
      body.meta ? JSON.stringify(body.meta) : null
    );
    return c.json({ status: "created", id: result.lastInsertRowid });
  });
  app.delete("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const db = getDb();
    db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
    return c.json({ status: "cleared" });
  });
  return app;
}
export {
  createChatRoutes
};
