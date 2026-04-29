function insertChatMessage(db, msg) {
  const embedsJson = msg.embeds && Object.keys(msg.embeds).length > 0 ? JSON.stringify(msg.embeds) : null;
  const metaJson = msg.meta && Object.keys(msg.meta).length > 0 ? JSON.stringify(msg.meta) : null;
  const result = db.prepare(
    `INSERT INTO chat_messages (session_id, actor, kind, content, embeds, meta)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    msg.sessionId,
    msg.actor,
    msg.kind,
    msg.content,
    embedsJson,
    metaJson
  );
  return Number(result.lastInsertRowid);
}
function updateChatMessageMeta(db, id, meta) {
  db.prepare(
    `UPDATE chat_messages SET meta = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(meta), id);
}
export {
  insertChatMessage,
  updateChatMessageMeta
};
