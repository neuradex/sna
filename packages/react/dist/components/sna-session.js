"use client";
import { jsx } from "react/jsx-runtime";
import { useMemo } from "react";
import { SnaContext, useSnaContext } from "../context.js";
function SnaSession({ id, children }) {
  const parent = useSnaContext();
  const value = useMemo(
    () => ({ ...parent, sessionId: id }),
    [parent, id]
  );
  return /* @__PURE__ */ jsx(SnaContext.Provider, { value, children });
}
export {
  SnaSession
};
