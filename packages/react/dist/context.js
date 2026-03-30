"use client";
import { createContext, useContext } from "react";
const DEFAULT_SNA_PORT = 3099;
const DEFAULT_SNA_URL = `http://localhost:${DEFAULT_SNA_PORT}`;
const SnaContext = createContext({ apiUrl: DEFAULT_SNA_URL, sessionId: "default" });
function useSnaContext() {
  return useContext(SnaContext);
}
export {
  DEFAULT_SNA_URL,
  SnaContext,
  useSnaContext
};
