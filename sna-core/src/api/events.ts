/**
 * GET /api/events?since=<id>
 *
 * SSE stream of skill_events from SQLite.
 * Polls every 500ms for new rows with id > lastSeen.
 * Client reconnects automatically on disconnect.
 */

import type { NextRequest } from "next/server";
import { getDb } from "../db/schema.js";

export const runtime = "nodejs";

const POLL_INTERVAL_MS = 500;
const KEEPALIVE_INTERVAL_MS = 15_000;

export async function GET(req: NextRequest) {
  const sinceParam = req.nextUrl.searchParams.get("since");
  let lastId = sinceParam ? parseInt(sinceParam) : -1;

  if (lastId === -1) {
    const db = getDb();
    const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get() as { maxId: number | null };
    lastId = row.maxId ?? 0;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      const pollTimer = setInterval(() => {
        if (closed) { clearInterval(pollTimer); clearInterval(keepaliveTimer); return; }

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
            send(`data: ${JSON.stringify(row)}\n\n`);
            lastId = row.id;
          }
        } catch {
          // DB might not be ready yet
        }
      }, POLL_INTERVAL_MS);

      const keepaliveTimer = setInterval(() => {
        send(`: keepalive\n\n`);
      }, KEEPALIVE_INTERVAL_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(keepaliveTimer);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
