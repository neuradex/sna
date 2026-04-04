/**
 * config.ts — SNA SDK centralized configuration.
 *
 * All configurable values live here. No other file reads process.env.SNA_*
 * or hardcodes policy defaults. Priority (later wins):
 *
 *   1. Hardcoded defaults (this file)
 *   2. Environment variables (process.env.SNA_*)
 *   3. App-level overrides (setConfig)
 *   4. Per-call parameter overrides (function args)
 */
interface SnaConfig {
    /** SNA API server port. env: SNA_PORT */
    port: number;
    /** Default LLM model. env: SNA_MODEL */
    model: string;
    /** Default agent provider. */
    defaultProvider: string;
    /** Default permission mode for agent operations. env: SNA_PERMISSION_MODE */
    defaultPermissionMode: string;
    /** Max concurrent sessions. env: SNA_MAX_SESSIONS */
    maxSessions: number;
    /** Max events buffered in memory per session. */
    maxEventBuffer: number;
    /**
     * Permission request timeout (ms). 0 = no timeout (app controls).
     * When > 0, auto-denies after this duration.
     */
    permissionTimeoutMs: number;
    /** Run-once execution timeout (ms). */
    runOnceTimeoutMs: number;
    /** Skill event SSE poll interval (ms). */
    pollIntervalMs: number;
    /** SSE keepalive interval (ms). */
    keepaliveIntervalMs: number;
    /** WebSocket skill event poll interval (ms). */
    skillPollMs: number;
    /** SQLite database path. env: SNA_DB_PATH */
    dbPath: string;
}
/** Get current config. Returns a frozen copy. */
declare function getConfig(): Readonly<SnaConfig>;
/** Override config values. Merges with existing (later wins). */
declare function setConfig(overrides: Partial<SnaConfig>): void;
/** Reset to defaults + env. Useful for testing. */
declare function resetConfig(): void;

export { type SnaConfig, getConfig, resetConfig, setConfig };
