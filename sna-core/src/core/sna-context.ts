"use client";

import { createContext, useContext } from "react";

export interface SnaConfig {
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
const DEFAULT_SNA_URL = "http://localhost:3099";

export const SnaContext = createContext<SnaConfig>({ apiUrl: DEFAULT_SNA_URL });

export function useSnaContext(): SnaConfig {
  return useContext(SnaContext);
}

export { DEFAULT_SNA_URL };
