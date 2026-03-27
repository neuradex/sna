"use client";
import { createContext, useContext } from "react";
const DEFAULT_SNA_URL = "http://localhost:3099";
const SnaContext = createContext({ apiUrl: DEFAULT_SNA_URL });
function useSnaContext() {
  return useContext(SnaContext);
}
export {
  DEFAULT_SNA_URL,
  SnaContext,
  useSnaContext
};
