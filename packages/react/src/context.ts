"use client";

import { createContext, useContext } from "react";
import { DEFAULT_SNA_URL } from "@sna-sdk/core";

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

export const SnaContext = createContext<SnaConfig>({ apiUrl: DEFAULT_SNA_URL });

export function useSnaContext(): SnaConfig {
  return useContext(SnaContext);
}

export { DEFAULT_SNA_URL };
