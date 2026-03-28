import * as react from 'react';

interface SnaConfig {
    /**
     * Base URL of the SNA internal API server.
     * e.g. "http://localhost:52341"
     *
     * Set automatically by SnaProvider (reads from .sna/sna-api.port).
     * Override via <SnaProvider snaUrl="..."> for custom deployments.
     */
    apiUrl: string;
}
/**
 * Fallback URL used only until the real port is discovered.
 * Consumers should NOT rely on this — port is dynamically allocated.
 */
declare const DEFAULT_SNA_URL = "http://localhost:3099";
declare const SnaContext: react.Context<SnaConfig>;
declare function useSnaContext(): SnaConfig;

export { DEFAULT_SNA_URL, type SnaConfig, SnaContext, useSnaContext };
