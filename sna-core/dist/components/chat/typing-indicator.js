"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
const SHIMMER_KEYFRAMES = `
@keyframes sna-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes sna-orbit {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;
let shimmerInjected = false;
function injectShimmer() {
  if (shimmerInjected || typeof document === "undefined") return;
  const s = document.createElement("style");
  s.id = "sna-shimmer-styles";
  s.textContent = SHIMMER_KEYFRAMES;
  document.head.appendChild(s);
  shimmerInjected = true;
}
function OrbitIcon() {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        width: 18,
        height: 18,
        position: "relative",
        flexShrink: 0
      },
      children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "1.5px solid transparent",
              borderTopColor: "var(--sna-accent)",
              animation: "sna-orbit 1.2s linear infinite"
            }
          }
        ),
        /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              position: "absolute",
              top: "50%",
              left: "50%",
              width: 5,
              height: 5,
              marginTop: -2.5,
              marginLeft: -2.5,
              borderRadius: "50%",
              background: "var(--sna-accent)",
              opacity: 0.8
            }
          }
        )
      ]
    }
  );
}
function TypingIndicator() {
  injectShimmer();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1e3);
    return () => clearInterval(t);
  }, []);
  const label = elapsed < 3 ? "Thinking" : elapsed < 10 ? "Reasoning" : "Still working";
  return /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 8px",
        width: "100%",
        background: "linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.06) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
        animation: "sna-shimmer 2.5s ease-in-out infinite"
      },
      children: [
        /* @__PURE__ */ jsx(OrbitIcon, {}),
        /* @__PURE__ */ jsxs(
          "span",
          {
            style: {
              fontSize: 13,
              color: "var(--sna-text-muted)",
              fontFamily: "var(--sna-font-mono)",
              letterSpacing: "0.02em"
            },
            children: [
              label,
              /* @__PURE__ */ jsx("span", { style: { opacity: 0.4 }, children: elapsed > 0 ? ` ${elapsed}s` : "" })
            ]
          }
        )
      ]
    }
  ) });
}
export {
  TypingIndicator
};
