"use client";
import { useMemo } from "react";
import { useSna } from "./use-sna.js";
function useSnaClient(options = {}) {
  const { bindSkills: bind, ...snaOptions } = options;
  const sna = useSna(snaOptions);
  const skills = useMemo(() => {
    if (!bind) return {};
    return bind(sna.runSkillInBackground);
  }, [bind, sna.runSkillInBackground]);
  return { ...sna, skills };
}
export {
  useSnaClient
};
