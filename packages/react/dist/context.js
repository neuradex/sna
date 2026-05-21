"use client";
import { createContext, useContext } from "react";
const DEFAULT_SNA_PORT = 3099;
const DEFAULT_SNA_URL = `http://localhost:${DEFAULT_SNA_PORT}`;
const SnaContext = createContext({ apiUrl: DEFAULT_SNA_URL, sessionId: "default" });
function useSnaContext() {
  return useContext(SnaContext);
}
function authHeaders(authToken, headers = {}) {
  const next = { ...headers };
  if (authToken) {
    next.Authorization = `Bearer ${authToken}`;
  }
  return Object.keys(next).length > 0 ? next : void 0;
}
export {
  DEFAULT_SNA_URL,
  SnaContext,
  authHeaders,
  useSnaContext
};
