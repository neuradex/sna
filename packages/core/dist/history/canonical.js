import { getDb } from "../db/schema.js";
function buildCanonicalFromDb(sessionId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, actor, kind, content, embeds, meta, created_at
       FROM chat_messages
      WHERE session_id = ?
      ORDER BY id ASC`
  ).all(sessionId);
  const out = [];
  for (const r of rows) {
    if (r.kind === "status" || r.kind === "error") continue;
    let embeds;
    if (r.embeds) {
      try {
        embeds = JSON.parse(r.embeds);
      } catch {
      }
    }
    let meta;
    if (r.meta) {
      try {
        meta = JSON.parse(r.meta);
      } catch {
      }
    }
    out.push({
      id: r.id,
      actor: r.actor,
      kind: r.kind,
      content: r.content,
      embeds,
      meta,
      createdAt: r.created_at
    });
  }
  return out;
}
export {
  buildCanonicalFromDb
};
