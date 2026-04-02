/**
 * @sna-sdk/core/node — Node.js launcher API
 *
 * Provides startSnaServer() to launch the SNA standalone server as a forked
 * child process from any Node.js application (Next.js, Express, Vite, etc.).
 *
 * For Electron apps, prefer @sna-sdk/core/electron — it additionally handles
 * asar path resolution and native binding auto-detection.
 *
 * @example
 * const { startSnaServer } = require("@sna-sdk/core/node");
 *
 * const sna = await startSnaServer({
 *   port: 3099,
 *   dbPath: path.join(process.cwd(), "data/sna.db"),
 *   permissionMode: "acceptEdits",
 *   onLog: (line) => console.log("[sna]", line),
 * });
 *
 * // sna.process — ChildProcess ref
 * // sna.port    — actual port
 * // sna.stop()  — graceful shutdown
 */

export { startSnaServer } from "../electron/index.js";
export type { SnaServerOptions, SnaServerHandle } from "../electron/index.js";
