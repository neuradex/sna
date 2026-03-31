import * as hono_utils_http_status from 'hono/utils/http-status';
import * as hono from 'hono';
import { Context } from 'hono';
import { SessionManager } from '../session-manager.js';
import '../../core/providers/types.js';

/**
 * Create an emit route handler that broadcasts to WS subscribers.
 */
declare function createEmitRoute(sessionManager: SessionManager): (c: Context) => Promise<(Response & hono.TypedResponse<{
    error: string;
}, 400, "json">) | (Response & hono.TypedResponse<{
    id: number;
}, hono_utils_http_status.ContentfulStatusCode, "json">)>;
/**
 * Legacy plain handler (no broadcast). Kept for backward compatibility
 * when consumers import emitRoute directly without SessionManager.
 */
declare function emitRoute(c: Context): Promise<(Response & hono.TypedResponse<{
    error: string;
}, 400, "json">) | (Response & hono.TypedResponse<{
    id: number;
}, hono_utils_http_status.ContentfulStatusCode, "json">)>;

export { createEmitRoute, emitRoute };
