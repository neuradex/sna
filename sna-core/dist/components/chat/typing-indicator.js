"use client";
import { jsx } from "react/jsx-runtime";
function TypingIndicator() {
  return /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "flex-start" }, children: /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        background: "var(--sna-surface)",
        border: "1px solid var(--sna-surface-border)",
        borderRadius: "var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-xl) var(--sna-radius-sm)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 6
      },
      children: [0, 1, 2].map((i) => /* @__PURE__ */ jsx(
        "span",
        {
          style: {
            width: 6,
            height: 6,
            borderRadius: "var(--sna-radius-full)",
            background: "var(--sna-text-icon)",
            animation: `sna-bounce 1.4s ease-in-out ${i * 0.16}s infinite`
          }
        },
        i
      ))
    }
  ) });
}
export {
  TypingIndicator
};
