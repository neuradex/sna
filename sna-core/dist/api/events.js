import { getDb } from "../db/schema.js";
const runtime = "nodejs";
const POLL_INTERVAL_MS = 500;
const KEEPALIVE_INTERVAL_MS = 15e3;
async function GET(req) {
  const sinceParam = req.nextUrl.searchParams.get("since");
  let lastId = sinceParam ? parseInt(sinceParam) : -1;
  if (lastId === -1) {
    const db = getDb();
    const row = db.prepare("SELECT MAX(id) as maxId FROM skill_events").get();
    lastId = row.maxId ?? 0;
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (payload) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };
      const pollTimer = setInterval(() => {
        if (closed) {
          clearInterval(pollTimer);
          clearInterval(keepaliveTimer);
          return;
        }
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
            send(`data: ${JSON.stringify(row)}

`);
            lastId = row.id;
          }
        } catch {
        }
      }, POLL_INTERVAL_MS);
      const keepaliveTimer = setInterval(() => {
        send(`: keepalive

`);
      }, KEEPALIVE_INTERVAL_MS);
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(keepaliveTimer);
        try {
          controller.close();
        } catch {
        }
      });
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
export {
  GET,
  runtime
};
