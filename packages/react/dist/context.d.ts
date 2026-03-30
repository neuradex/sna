import * as react from 'react';

declare const DEFAULT_SNA_URL = "http://localhost:3099";
interface SnaConfig {
    /**
     * Base URL of the SNA internal API server.
     * e.g. "http://localhost:52341"
     *
     * Set automatically by SnaProvider (reads from .sna/sna-api.port).
     * Override via <SnaProvider snaUrl="..."> for custom deployments.
     */
    apiUrl: string;
    /**
     * Active session ID for this scope.
     * Set by <SnaSession id="...">. Defaults to "default".
     */
    sessionId: string;
}
declare const SnaContext: react.Context<SnaConfig>;
declare function useSnaContext(): SnaConfig;

export { DEFAULT_SNA_URL, type SnaConfig, SnaContext, useSnaContext };
