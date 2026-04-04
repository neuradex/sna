import { streamSSE } from "hono/streaming";
import { getDb } from "../../db/schema.js";
import { getConfig } from "../../config.js";
function eventsRoute(c) {
  const sinceParam = c.req.query("since");
  let lastId = sinceParam ? parseInt(sinceParam) : -1;
  if (lastId <= 0) {
    const db = getDb();
    const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get();
    lastId = row.maxId ?? 0;
  }
  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    const keepaliveTimer = setInterval(async () => {
      if (closed) {
        clearInterval(keepaliveTimer);
        return;
      }
      try {
        await stream.writeSSE({ data: "", event: "keepalive" });
      } catch {
        closed = true;
        clearInterval(keepaliveTimer);
      }
    }, getConfig().keepaliveIntervalMs);
    while (!closed) {
      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT id, skill, type, message, data, created_at
          FROM skill_events
          WHERE id > ?
          ORDER BY id ASC
          LIMIT 50
        `).all(lastId);
        for (const row of rows) {
          if (closed) break;
          await stream.writeSSE({ data: JSON.stringify(row) });
          lastId = row.id;
        }
      } catch {
      }
      await stream.sleep(getConfig().pollIntervalMs);
    }
    clearInterval(keepaliveTimer);
  });
}
export {
  eventsRoute
};
