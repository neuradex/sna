import { Context } from 'hono';

/**
 * GET /events?since=<id>
 *
 * SSE stream of skill_events from SQLite.
 * Polls every 500ms for new rows with id > lastSeen.
 */

declare function eventsRoute(c: Context): Response;

export { eventsRoute };
