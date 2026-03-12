import { NextRequest } from 'next/server';

/**
 * GET /api/events?since=<id>
 *
 * SSE stream of skill_events from SQLite.
 * Polls every 500ms for new rows with id > lastSeen.
 * Client reconnects automatically on disconnect.
 */

declare const runtime = "nodejs";
declare function GET(req: NextRequest): Promise<Response>;

export { GET, runtime };
