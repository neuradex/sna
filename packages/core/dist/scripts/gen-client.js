import fs from "fs";
import path from "path";
import { scanSkills } from "../lib/skill-parser.js";
const ROOT = process.cwd();
function parseFlags(args) {
  const flags2 = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (key) flags2[key] = args[i + 1] ?? "";
  }
  return flags2;
}
function tsType(argDef) {
  switch (argDef.type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string[]":
      return "string[]";
    case "number[]":
      return "number[]";
    default:
      return "string";
  }
}
function generateClient(schemas2) {
  const lines = [];
  lines.push(`/**`);
  lines.push(` * SNA Client \u2014 Auto-generated from SKILL.md frontmatter.`);
  lines.push(` * DO NOT EDIT. Re-generate with: sna gen client`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import type { SkillResult } from "@sna-sdk/react/hooks";`);
  lines.push(``);
  for (const s of schemas2) {
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
  lines.push(`export interface SnaSkills {`);
  for (const s of schemas2) {
    const argEntries = Object.entries(s.args);
    const argsType = argEntries.length > 0 ? `${capitalize(s.camelName)}Args` : "void";
    lines.push(`  /** ${s.description} */`);
    lines.push(`  ${s.camelName}: (${argsType === "void" ? "" : `args: ${argsType}`}) => Promise<SkillResult>;`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const skillDefinitions = {`);
  for (const s of schemas2) {
    const argKeys = Object.keys(s.args);
    lines.push(`  ${s.camelName}: { name: "${s.name}", argKeys: [${argKeys.map((k) => `"${k}"`).join(", ")}] },`);
  }
  lines.push(`} as const;`);
  lines.push(``);
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
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const [, , ...rawArgs] = process.argv;
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
console.log(`\u2713 Generated ${outPath}`);
console.log(`  ${schemas.length} skills:`);
for (const s of schemas) {
  const argCount = Object.keys(s.args).length;
  console.log(`    ${s.camelName}(${argCount > 0 ? `{${Object.keys(s.args).join(", ")}}` : ""}) \u2192 ${s.name}`);
}
