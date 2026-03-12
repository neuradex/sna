"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { memo } from "react";
import { TerminalPanel } from "./terminal/terminal-panel.js";
const StableTerminalPanel = memo(TerminalPanel);
function SnaProvider({ children, className }) {
  return /* @__PURE__ */ jsxs("div", { className: "flex h-screen overflow-hidden", children: [
    /* @__PURE__ */ jsx("div", { className: `flex-1 overflow-auto min-w-0 ${className ?? ""}`, children }),
    /* @__PURE__ */ jsx(StableTerminalPanel, {})
  ] });
}
export {
  SnaProvider
};
