"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { memo, useEffect } from "react";
import { TerminalPanel } from "./terminal/terminal-panel.js";
import { useTerminalStore } from "../stores/terminal-store.js";
const StableTerminalPanel = memo(function StableTerminalPanel2({ dangerouslySkipPermissions }) {
  return /* @__PURE__ */ jsx(TerminalPanel, { dangerouslySkipPermissions });
});
function LnaProvider({
  children,
  className,
  defaultOpen = false,
  dangerouslySkipPermissions = false
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("terminal-panel")) {
      useTerminalStore.getState().setOpen(defaultOpen);
    }
  }, []);
  return /* @__PURE__ */ jsxs("div", { className: "flex h-screen overflow-hidden", children: [
    /* @__PURE__ */ jsx("div", { className: `flex-1 overflow-auto min-w-0 ${className ?? ""}`, children }),
    /* @__PURE__ */ jsx(StableTerminalPanel, { dangerouslySkipPermissions })
  ] });
}
export {
  LnaProvider
};
