"use client";
import { jsx } from "react/jsx-runtime";
import { TERMINAL_BAR_HEIGHT } from "../lib/terminal/constants.js";
function TerminalSpacer() {
  return /* @__PURE__ */ jsx("div", { style: { height: TERMINAL_BAR_HEIGHT, flexShrink: 0 } });
}
export {
  TerminalSpacer
};
