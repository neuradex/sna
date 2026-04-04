import { getConfig, setConfig, resetConfig } from "./config.js";
const DEFAULT_SNA_PORT = 3099;
const DEFAULT_SNA_URL = `http://localhost:${DEFAULT_SNA_PORT}`;
import { open, send, close, createHandle } from "./lib/dispatch.js";
export {
  DEFAULT_SNA_PORT,
  DEFAULT_SNA_URL,
  createHandle as createDispatchHandle,
  close as dispatchClose,
  open as dispatchOpen,
  send as dispatchSend,
  getConfig,
  resetConfig,
  setConfig
};
