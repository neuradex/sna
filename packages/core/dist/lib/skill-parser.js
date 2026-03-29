import fs from "fs";
import path from "path";
import yaml from "js-yaml";
function toCamelCase(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yaml.load(match[1]);
  } catch {
    return null;
  }
}
function parseSkillFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const fm = parseFrontmatter(content);
  if (!fm) return null;
  const name = path.basename(path.dirname(filePath));
  const description = fm.description ?? "";
  const sna = fm.sna;
  const rawArgs = sna?.args ?? {};
  const args = {};
  for (const [key, def] of Object.entries(rawArgs)) {
    args[key] = {
      type: def.type ?? "string",
      required: def.required === true,
      description: def.description ?? void 0
    };
  }
  return {
    name,
    camelName: toCamelCase(name),
    description,
    args
  };
}
function scanSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  const schemas = [];
  const entries = fs.readdirSync(skillsDir);
  for (const entry of entries) {
    const skillMd = path.join(skillsDir, entry, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const schema = parseSkillFile(skillMd);
    if (schema) schemas.push(schema);
  }
  return schemas;
}
export {
  parseSkillFile,
  scanSkills
};
