"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
const sIco = { stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
function IconBolt() {
  return /* @__PURE__ */ jsx("svg", { width: 14, height: 14, viewBox: "0 0 24 24", ...sIco, children: /* @__PURE__ */ jsx("path", { d: "M13 3L4 14h7l-2 7 9-11h-7l2-7" }) });
}
function SkillCard({ message }) {
  const [expanded, setExpanded] = useState(false);
  const skillName = message.skillName ?? "skill";
  const status = message.meta?.status ?? "running";
  const milestones = message.meta?.milestones ?? [];
  const isComplete = status === "complete" || status === "success";
  const isError = status === "error" || status === "failed";
  const isRunning = !isComplete && !isError;
  const hasMilestones = milestones.length > 0;
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        onClick: () => hasMilestones && setExpanded(!expanded),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 0",
          cursor: hasMilestones ? "pointer" : void 0
        },
        children: [
          hasMilestones && /* @__PURE__ */ jsx(
            "svg",
            {
              width: 8,
              height: 8,
              viewBox: "0 0 8 8",
              style: {
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
                flexShrink: 0,
                opacity: 0.4
              },
              children: /* @__PURE__ */ jsx("path", { d: "M2 1L6 4L2 7", stroke: "currentColor", strokeWidth: "1.2", fill: "none", strokeLinecap: "round" })
            }
          ),
          /* @__PURE__ */ jsx("span", { style: { color: isError ? "var(--sna-error-text)" : "var(--sna-accent)", flexShrink: 0, display: "flex" }, children: /* @__PURE__ */ jsx(IconBolt, {}) }),
          /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "var(--sna-font-mono)",
                color: isError ? "var(--sna-error-text)" : "var(--sna-accent-hover)"
              },
              children: skillName
            }
          ),
          isRunning && /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--sna-accent-hover)",
                animation: "sna-pulse 2s ease-in-out infinite",
                flexShrink: 0
              }
            }
          ),
          isComplete && /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-success)", display: "flex", flexShrink: 0, opacity: 0.6 }, children: /* @__PURE__ */ jsx("svg", { width: 10, height: 10, viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: "2", fill: "none", strokeLinecap: "round", children: /* @__PURE__ */ jsx("path", { d: "M5 12l5 5L20 7" }) }) }),
          isError && /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-error-text)", display: "flex", flexShrink: 0, opacity: 0.6 }, children: /* @__PURE__ */ jsx("svg", { width: 10, height: 10, viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: "2", fill: "none", strokeLinecap: "round", children: /* @__PURE__ */ jsx("path", { d: "M18 6L6 18M6 6l12 12" }) }) })
        ]
      }
    ),
    expanded && hasMilestones && /* @__PURE__ */ jsx("div", { style: { padding: "2px 0 2px 24px" }, children: milestones.map((m, i) => /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          fontSize: 10,
          fontFamily: "var(--sna-font-mono)",
          color: "var(--sna-text-faint)",
          lineHeight: 1.6,
          opacity: 0.7
        },
        children: m
      },
      i
    )) }),
    !expanded && message.content && message.content !== skillName && /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          fontSize: 10,
          fontFamily: "var(--sna-font-mono)",
          color: "var(--sna-text-faint)",
          padding: "1px 0 1px 24px",
          opacity: 0.7
        },
        children: message.content
      }
    )
  ] });
}
export {
  SkillCard
};
