import * as react from 'react';
export { DEFAULT_SNA_URL } from '@sna-sdk/core';

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
declare const SnaContext: react.Context<SnaConfig>;
declare function useSnaContext(): SnaConfig;

export { type SnaConfig, SnaContext, useSnaContext };
