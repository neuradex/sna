import { getDb } from "../../db/schema.js";
function createEmitRoute(sessionManager) {
  return async (c) => {
    const body = await c.req.json();
    const { skill, type, message, data, session_id } = body;
    if (!skill || !type || !message) {
      return c.json({ error: "missing fields" }, 400);
    }
    const db = getDb();
    const result = db.prepare(
      `INSERT INTO skill_events (session_id, skill, type, message, data) VALUES (?, ?, ?, ?, ?)`
    ).run(session_id ?? null, skill, type, message, data ?? null);
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
    return c.json({ id });
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
