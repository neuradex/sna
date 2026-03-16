import { getDb } from "../../db/schema.js";
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
  emitRoute
};
