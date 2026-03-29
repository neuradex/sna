/**
 * SNA Client — Auto-generated from SKILL.md frontmatter.
 * Re-generate with: sna gen client
 */

import type { SkillResult } from "@sna-sdk/react/hooks";

/** Args for the hello skill */
export interface HelloArgs {
  /** Name of the person to greet */
  name: string;
}

export interface SnaSkills {
  /** Say hello to someone and demonstrate the SNA event pipeline */
  hello: (args: HelloArgs) => Promise<SkillResult>;
}

export const skillDefinitions = {
  hello: { name: "hello", argKeys: ["name"] },
} as const;

/**
 * Bind skill methods to a runner function.
 * Pass this to useSnaClient: `useSnaClient({ bindSkills })`
 *
 * @example
 * const { skills } = useSnaClient({ bindSkills });
 * await skills.hello({ name: "World" });
 */
export function bindSkills(
  runner: (command: string) => Promise<SkillResult>,
): SnaSkills {
  return {
    hello: (args: HelloArgs) => {
      const parts = [skillDefinitions.hello.name];
      for (const key of skillDefinitions.hello.argKeys) {
        const val = args[key as keyof HelloArgs];
        if (val !== undefined) parts.push(String(val));
      }
      return runner(parts.join(" "));
    },
  };
}
