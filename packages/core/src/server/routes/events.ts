/**
 * GET /events?since=<id>
 *
 * SSE stream of skill_events from SQLite.
 * Polls every 500ms for new rows with id > lastSeen.
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { getDb } from "../../db/schema.js";

const POLL_INTERVAL_MS = 500;
const KEEPALIVE_INTERVAL_MS = 15_000;

export function eventsRoute(c: Context) {
  const sinceParam = c.req.query("since");
  let lastId = sinceParam ? parseInt(sinceParam) : -1;

  if (lastId <= 0) {
    const db = getDb();
    const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get() as { maxId: number | null };
    lastId = row.maxId ?? 0;
  }

  return streamSSE(c, async (stream) => {
    let closed = false;

    stream.onAbort(() => {
      closed = true;
    });

    // Keepalive
    const keepaliveTimer = setInterval(async () => {
      if (closed) { clearInterval(keepaliveTimer); return; }
      try {
        await stream.writeSSE({ data: "", event: "keepalive" });
      } catch {
        closed = true;
        clearInterval(keepaliveTimer);
      }
    }, KEEPALIVE_INTERVAL_MS);

    // Poll loop
    while (!closed) {
      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT id, skill, type, message, data, created_at
          FROM skill_events
          WHERE id > ?
          ORDER BY id ASC
          LIMIT 50
        `).all(lastId) as Array<{
          id: number; skill: string; type: string;
          message: string; data: string | null; created_at: string;
        }>;

        for (const row of rows) {
          if (closed) break;
          await stream.writeSSE({ data: JSON.stringify(row) });
          lastId = row.id;
        }
      } catch {
        // DB might not be ready yet
      }

      await stream.sleep(POLL_INTERVAL_MS);
    }

    clearInterval(keepaliveTimer);
  });
}
