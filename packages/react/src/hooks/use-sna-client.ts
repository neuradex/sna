"use client";

import { useMemo } from "react";
import { useSna, type SkillResult } from "./use-sna.js";
import type { SkillEventHandler } from "./use-skill-events.js";
import type { AgentEvent } from "./use-agent.js";

interface UseSnaClientOptions {
  sessionId?: string;
  skills?: string[];
  maxEvents?: number;
  provider?: string;
  permissionMode?: string;
  onEvent?: SkillEventHandler;
  onTextDelta?: (e: AgentEvent) => void;
  onComplete?: (e: AgentEvent) => void;
}

/**
 * useSnaClient — wraps useSna and binds a generated skill client.
 *
 * @example
 * import { bindSkills } from "./sna-client";  // auto-generated
 *
 * function MyComponent() {
 *   const { skills, ...sna } = useSnaClient({ bindSkills });
 *   await skills.formFill({ sessionId: 123 });
 * }
 */
export function useSnaClient<T>(
  options: UseSnaClientOptions & {
    bindSkills?: (runner: (command: string) => Promise<SkillResult>) => T;
  } = {},
) {
  const { bindSkills: bind, ...snaOptions } = options;
  const sna = useSna(snaOptions);

  const skills = useMemo(() => {
    if (!bind) return {} as T;
    return bind(sna.runSkillInBackground);
  }, [bind, sna.runSkillInBackground]);

  return { ...sna, skills };
}

export type { SkillResult };
