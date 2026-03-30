"use client";

import { createContext, useContext } from "react";

const DEFAULT_SNA_PORT = 3099;
const DEFAULT_SNA_URL = `http://localhost:${DEFAULT_SNA_PORT}`;

export interface SnaConfig {
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

export const SnaContext = createContext<SnaConfig>({ apiUrl: DEFAULT_SNA_URL, sessionId: "default" });

export function useSnaContext(): SnaConfig {
  return useContext(SnaContext);
}

export { DEFAULT_SNA_URL };
