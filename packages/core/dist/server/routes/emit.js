import { getDb } from "../../db/schema.js";
import { httpJson } from "../api-types.js";
function createEmitRoute(sessionManager) {
  return async (c) => {
    const body = await c.req.json();
    const { skill, message, data } = body;
    const type = body.type ?? body.eventType;
    const session_id = c.req.query("session") ?? body.session_id ?? body.session ?? null;
    if (!skill || !type || !message) {
      return c.json({ error: "missing fields" }, 400);
    }
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO skill_events (session_id, skill, type, message, data) VALUES (?, ?, ?, ?, ?)`
    ).run(session_id, skill, type, message, data ?? null);
    const id = Number(result.lastInsertRowid);
    sessionManager.broadcastSkillEvent({
      id,
      session_id: session_id ?? null,
      skill,
      type,
      message,
      data: data ?? null,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    return httpJson(c, "emit", { id });
  };
}
async function emitRoute(c) {
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
export {
  createEmitRoute,
  emitRoute
};
