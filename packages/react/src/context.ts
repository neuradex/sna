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
  /** Bearer token issued by the SNA server. */
  authToken?: string;
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

export function authHeaders(
  authToken: string | undefined,
  headers: Record<string, string> = {},
): Record<string, string> | undefined {
  const next = { ...headers };
  if (authToken) {
    next.Authorization = `Bearer ${authToken}`;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export { DEFAULT_SNA_URL };
