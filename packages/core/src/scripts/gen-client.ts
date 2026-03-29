/**
 * gen-client.ts — Generate a typed SNA client from SKILL.md frontmatter.
 *
 * Usage:
 *   sna gen client [--out <path>] [--skills-dir <path>]
 *
 * Scans .claude/skills/ for SKILL.md files with `sna.args` frontmatter
 * and generates a TypeScript file with typed skill methods.
 */

import fs from "fs";
import path from "path";
import { scanSkills, type SkillSchema, type SkillArgDef } from "../lib/skill-parser.js";

const ROOT = process.cwd();

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (key) flags[key] = args[i + 1] ?? "";
  }
  return flags;
}

function tsType(argDef: SkillArgDef): string {
  switch (argDef.type) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "string[]": return "string[]";
    case "number[]": return "number[]";
    default: return "string";
  }
}

function generateClient(schemas: SkillSchema[]): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * SNA Client — Auto-generated from SKILL.md frontmatter.`);
  lines.push(` * DO NOT EDIT. Re-generate with: sna gen client`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import type { SkillResult } from "@sna-sdk/react/hooks";`);
  lines.push(``);

  // Generate arg interfaces
  for (const s of schemas) {
    const argEntries = Object.entries(s.args);
    if (argEntries.length > 0) {
      lines.push(`export interface ${capitalize(s.camelName)}Args {`);
      for (const [key, def] of argEntries) {
        if (def.description) lines.push(`  /** ${def.description} */`);
        lines.push(`  ${key}${def.required ? "" : "?"}: ${tsType(def)};`);
      }
      lines.push(`}`);
      lines.push(``);
    }
  }

  // Generate skills type
  lines.push(`export interface SnaSkills {`);
  for (const s of schemas) {
    const argEntries = Object.entries(s.args);
    const argsType = argEntries.length > 0 ? `${capitalize(s.camelName)}Args` : "void";
    lines.push(`  /** ${s.description} */`);
    lines.push(`  ${s.camelName}: (${argsType === "void" ? "" : `args: ${argsType}`}) => Promise<SkillResult>;`);
  }
  lines.push(`}`);
  lines.push(``);

  // Generate skill definitions for runtime
  lines.push(`export const skillDefinitions = {`);
  for (const s of schemas) {
    const argKeys = Object.keys(s.args);
    lines.push(`  ${s.camelName}: { name: "${s.name}", argKeys: [${argKeys.map(k => `"${k}"`).join(", ")}] },`);
  }
  lines.push(`} as const;`);
  lines.push(``);

  // Generate createClient helper
  lines.push(`/**`);
  lines.push(` * Create a typed SNA client.`);
  lines.push(` *`);
  lines.push(` * @example`);
  lines.push(` * const { skills } = useSnaClient();`);
  lines.push(` * await skills.formFill({ sessionId: 123 });`);
  lines.push(` */`);
  lines.push(`export function bindSkills(`);
  lines.push(`  runner: (command: string) => Promise<SkillResult>,`);
  lines.push(`): SnaSkills {`);
  lines.push(`  const skills = {} as SnaSkills;`);
  lines.push(`  for (const [method, def] of Object.entries(skillDefinitions)) {`);
  lines.push(`    (skills as any)[method] = (args?: Record<string, unknown>) => {`);
  lines.push(`      const parts = [def.name];`);
  lines.push(`      if (args) {`);
  lines.push(`        for (const key of def.argKeys) {`);
  lines.push(`          if (args[key] !== undefined) {`);
  lines.push(`            const val = args[key];`);
  lines.push(`            parts.push(Array.isArray(val) ? val.join(" ") : String(val));`);
  lines.push(`          }`);
  lines.push(`        }`);
  lines.push(`      }`);
  lines.push(`      return runner(parts.join(" "));`);
  lines.push(`    };`);
  lines.push(`  }`);
  lines.push(`  return skills;`);
  lines.push(`}`);

  return lines.join("\n") + "\n";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Main ──

const [,, ...rawArgs] = process.argv;
const flags = parseFlags(rawArgs);

const skillsDir = flags["skills-dir"] ?? path.join(ROOT, ".claude/skills");
const outPath = flags.out ?? path.join(ROOT, "src/sna-client.ts");

const schemas = scanSkills(skillsDir);

if (schemas.length === 0) {
  console.log("No skills with sna.args found in", skillsDir);
  process.exit(0);
}

const code = generateClient(schemas);
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, code);

console.log(`✓ Generated ${outPath}`);
console.log(`  ${schemas.length} skills:`);
for (const s of schemas) {
  const argCount = Object.keys(s.args).length;
  console.log(`    ${s.camelName}(${argCount > 0 ? `{${Object.keys(s.args).join(", ")}}` : ""}) → ${s.name}`);
}
