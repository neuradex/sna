"use client";
import { createContext, useContext } from "react";
import { DEFAULT_SNA_URL } from "@sna-sdk/core";
const SnaContext = createContext({ apiUrl: DEFAULT_SNA_URL });
function useSnaContext() {
  return useContext(SnaContext);
}
export {
  DEFAULT_SNA_URL,
  SnaContext,
  useSnaContext
};
