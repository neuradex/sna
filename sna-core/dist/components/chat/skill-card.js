"use client";
import { jsx, jsxs } from "react/jsx-runtime";
function SkillCard({ message }) {
  const skillName = message.skillName ?? "skill";
  const status = message.meta?.status ?? "running";
  const milestones = message.meta?.milestones ?? [];
  const isComplete = status === "complete" || status === "success";
  const isError = status === "error" || status === "failed";
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        padding: "12px 14px",
        background: isError ? "var(--sna-error-bg)" : isComplete ? "var(--sna-surface)" : "var(--sna-accent-soft)",
        border: `1px solid ${isError ? "var(--sna-error-border)" : isComplete ? "var(--sna-surface-border)" : "var(--sna-accent-soft-border)"}`,
        borderRadius: "var(--sna-radius-lg)"
      },
      children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: milestones.length ? 8 : 0 }, children: [
          /* @__PURE__ */ jsx("span", { style: { fontSize: 14 }, children: "\u26A1" }),
          /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--sna-font-mono)",
                color: isError ? "var(--sna-error-text)" : "var(--sna-accent-hover)"
              },
              children: skillName
            }
          ),
          !isComplete && !isError && /* @__PURE__ */ jsx(
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
          isComplete && /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-success)", fontSize: 12, fontWeight: 600 }, children: "\u2713" }),
          isError && /* @__PURE__ */ jsx("span", { style: { color: "var(--sna-error-text)", fontSize: 12, fontWeight: 600 }, children: "\u2717" })
        ] }),
        milestones.length > 0 && /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 4, paddingLeft: 22 }, children: milestones.map((m, i) => /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--sna-text-muted)"
            },
            children: [
              /* @__PURE__ */ jsx(
                "span",
                {
                  style: {
                    width: 4,
                    height: 4,
                    borderRadius: "var(--sna-radius-full)",
                    background: "var(--sna-success)",
                    flexShrink: 0
                  }
                }
              ),
              m
            ]
          },
          i
        )) }),
        message.content && message.content !== skillName && /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              fontSize: 12,
              color: "var(--sna-text-muted)",
              marginTop: 6,
              paddingLeft: 22
            },
            children: message.content
          }
        )
      ]
    }
  );
}
export {
  SkillCard
};
