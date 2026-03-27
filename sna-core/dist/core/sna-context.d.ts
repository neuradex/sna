import * as react from 'react';

interface SnaConfig {
    /**
     * Base URL of the SNA internal API server.
     * e.g. "http://localhost:3099"
     *
     * Set automatically by SnaProvider.
     * Override via <SnaProvider snaUrl="..."> for custom deployments.
     */
    apiUrl: string;
}
declare const DEFAULT_SNA_URL = "http://localhost:3099";
declare const SnaContext: react.Context<SnaConfig>;
declare function useSnaContext(): SnaConfig;

export { DEFAULT_SNA_URL, type SnaConfig, SnaContext, useSnaContext };
