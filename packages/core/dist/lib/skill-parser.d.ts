/**
 * skill-parser.ts — Parse SKILL.md frontmatter for sna schema definitions.
 *
 * Reads .claude/skills/<name>/SKILL.md files and extracts the `sna` field
 * from YAML frontmatter.
 */
interface SkillArgDef {
    type: "string" | "number" | "boolean" | "string[]" | "number[]";
    required?: boolean;
    description?: string;
}
interface SkillSchema {
    name: string;
    camelName: string;
    description: string;
    args: Record<string, SkillArgDef>;
}
/** Parse a single SKILL.md file and extract sna schema. */
declare function parseSkillFile(filePath: string): SkillSchema | null;
/** Scan a directory for SKILL.md files and parse all sna schemas. */
declare function scanSkills(skillsDir: string): SkillSchema[];

export { type SkillArgDef, type SkillSchema, parseSkillFile, scanSkills };
