/**
 * @deprecated The HTTP agent routes now live in `routes/openapi.ts` and are
 * mounted automatically by `createSnaApp()`. This module survives only to
 * keep the `@sna-sdk/core/server/routes/agent` subpath export working for
 * consumers who imported `runOnce` from here historically.
 *
 * Import `runOnce` from `@sna-sdk/core/server` directly instead.
 */

export { runOnce } from "../run-once.js";
export type { RunOnceOptions, RunOnceResult } from "../run-once.js";
