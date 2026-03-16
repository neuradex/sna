import * as hono_utils_http_status from 'hono/utils/http-status';
import * as hono from 'hono';
import { Context } from 'hono';

declare function emitRoute(c: Context): Promise<(Response & hono.TypedResponse<{
    error: string;
}, 400, "json">) | (Response & hono.TypedResponse<{
    id: number;
}, hono_utils_http_status.ContentfulStatusCode, "json">)>;

export { emitRoute };
