/**
 * skill-parser.ts — Parse SKILL.md frontmatter for sna schema definitions.
 *
 * Reads .claude/skills/<name>/SKILL.md files and extracts the `sna` field
 * from YAML frontmatter.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export interface SkillArgDef {
  type: "string" | "number" | "boolean" | "string[]" | "number[]";
  required?: boolean;
  description?: string;
}

export interface SkillSchema {
  name: string;            // folder name (kebab-case)
  camelName: string;       // camelCase version for method name
  description: string;
  args: Record<string, SkillArgDef>;
}

function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yaml.load(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parse a single SKILL.md file and extract sna schema. */
export function parseSkillFile(filePath: string): SkillSchema | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const fm = parseFrontmatter(content);
  if (!fm) return null;

  const name = path.basename(path.dirname(filePath));
  const description = (fm.description as string) ?? "";
  const sna = fm.sna as Record<string, unknown> | undefined;
  const rawArgs = (sna?.args ?? {}) as Record<string, Record<string, unknown>>;

  const args: Record<string, SkillArgDef> = {};
  for (const [key, def] of Object.entries(rawArgs)) {
    args[key] = {
      type: (def.type as SkillArgDef["type"]) ?? "string",
      required: def.required === true,
      description: (def.description as string) ?? undefined,
    };
  }

  return {
    name,
    camelName: toCamelCase(name),
    description,
    args,
  };
}

/** Scan a directory for SKILL.md files and parse all sna schemas. */
export function scanSkills(skillsDir: string): SkillSchema[] {
  if (!fs.existsSync(skillsDir)) return [];

  const schemas: SkillSchema[] = [];
  const entries = fs.readdirSync(skillsDir);

  for (const entry of entries) {
    const skillMd = path.join(skillsDir, entry, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const schema = parseSkillFile(skillMd);
    if (schema) schemas.push(schema);
  }

  return schemas;
}
