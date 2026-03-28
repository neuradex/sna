"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
function Tooltip({ content, children }) {
  return /* @__PURE__ */ jsx(TooltipPrimitive.Provider, { delayDuration: 200, children: /* @__PURE__ */ jsxs(TooltipPrimitive.Root, { children: [
    /* @__PURE__ */ jsx(TooltipPrimitive.Trigger, { asChild: true, children }),
    /* @__PURE__ */ jsx(TooltipPrimitive.Portal, { children: /* @__PURE__ */ jsxs(
      TooltipPrimitive.Content,
      {
        side: "top",
        sideOffset: 6,
        style: {
          padding: "6px 10px",
          borderRadius: 6,
          background: "#1a1a2e",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          color: "rgba(255,255,255,0.8)",
          fontSize: 11,
          fontFamily: "var(--sna-font-mono)",
          whiteSpace: "nowrap",
          zIndex: 9999,
          animationDuration: "0.15s"
        },
        children: [
          content,
          /* @__PURE__ */ jsx(
            TooltipPrimitive.Arrow,
            {
              style: { fill: "#1a1a2e" },
              width: 10,
              height: 5
            }
          )
        ]
      }
    ) })
  ] }) });
}
export {
  Tooltip
};
