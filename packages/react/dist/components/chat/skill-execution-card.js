"use client";
import { jsx, jsxs } from "react/jsx-runtime";
function SkillExecutionCard({ skillName, events }) {
  const latestMilestone = events.filter((e) => e.type === "milestone").at(-1);
  const isComplete = events.some(
    (e) => e.type === "complete" || e.type === "success"
  );
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        border: "1px solid var(--sna-accent-soft-border)",
        background: "var(--sna-accent-soft)",
        borderRadius: "var(--sna-radius-lg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8
      },
      children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                fontFamily: "var(--sna-font-mono)",
                fontSize: 12,
                color: "var(--sna-accent-hover)"
              },
              children: skillName
            }
          ),
          !isComplete && /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                width: 6,
                height: 6,
                borderRadius: "var(--sna-radius-full)",
                background: "var(--sna-accent-hover)",
                animation: "sna-pulse 2s ease-in-out infinite"
              }
            }
          ),
          isComplete && /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-success)", fontSize: 12 }, children: "\u2713" })
        ] }),
        latestMilestone && /* @__PURE__ */ jsx("p", { style: { color: "var(--sna-text-muted)", fontSize: 12, margin: 0 }, children: latestMilestone.message }),
        /* @__PURE__ */ jsxs(
          "span",
          {
            style: {
              color: "var(--sna-text-faint)",
              fontSize: 10,
              fontFamily: "var(--sna-font-mono)"
            },
            children: [
              events.length,
              " events"
            ]
          }
        )
      ]
    }
  );
}
export {
  SkillExecutionCard
};
