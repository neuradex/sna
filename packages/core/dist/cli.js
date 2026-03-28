import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const [, , command] = process.argv;
switch (command) {
  case "link":
    cmdLink();
    break;
  case "install":
    cmdInstall();
    break;
  default:
    console.log(`
${chalk.bold("sna")} \u2014 Skills-Native Application core primitives

${chalk.bold("Usage:")}
  sna link      Create/update .claude/skills symlinks
  sna install   Add sna to package.json and link skills
`);
}
function cmdLink() {
  const cwd = process.cwd();
  const claudeDir = path.join(cwd, ".claude");
  const skillsDir = path.join(claudeDir, "skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
    console.log(chalk.gray(`  created  .claude/skills/`));
  }
  const coreSkillsDir = path.join(PACKAGE_ROOT, "skills");
  if (!fs.existsSync(coreSkillsDir)) {
    console.error(chalk.red(`  \u2717  sna skills directory not found: ${coreSkillsDir}`));
    process.exit(1);
  }
  const skills = fs.readdirSync(coreSkillsDir).filter(
    (f) => fs.statSync(path.join(coreSkillsDir, f)).isDirectory()
  );
  let linked = 0;
  let updated = 0;
  let skipped = 0;
  for (const skill of skills) {
    const linkPath = path.join(skillsDir, skill);
    const target = path.relative(skillsDir, path.join(coreSkillsDir, skill));
    let existing = null;
    try {
      existing = fs.lstatSync(linkPath);
    } catch {
    }
    if (existing) {
      if (existing.isSymbolicLink()) {
        const currentTarget = fs.readlinkSync(linkPath);
        if (currentTarget === target) {
          skipped++;
          continue;
        }
        fs.unlinkSync(linkPath);
        fs.symlinkSync(target, linkPath);
        console.log(chalk.cyan(`  updated  .claude/skills/${skill}/ \u2192 ${target}`));
        updated++;
      } else {
        console.log(chalk.yellow(`  skipped  .claude/skills/${skill}/  (not a symlink \u2014 won't overwrite)`));
        skipped++;
      }
    } else {
      fs.symlinkSync(target, linkPath);
      console.log(chalk.green(`  linked   .claude/skills/${skill}/ \u2192 ${target}`));
      linked++;
    }
  }
  console.log();
  if (linked + updated > 0) {
    console.log(chalk.green(`\u2713  ${linked + updated} skill(s) linked`));
  } else {
    console.log(chalk.gray(`\u2713  Skills already up to date`));
  }
  if (skipped > 0 && linked + updated > 0) {
    console.log(chalk.gray(`   (${skipped} unchanged)`));
  }
}
function cmdInstall() {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.error(chalk.red("  \u2717  No package.json found in current directory"));
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const hasSnaCoreAlready = pkg.dependencies?.["sna"] || pkg.devDependencies?.["sna"];
  if (!hasSnaCoreAlready) {
    const snaPkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
    const version = snaPkg.version ?? "latest";
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.dependencies["sna"] = `^${version}`;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(chalk.green(`  added    "sna": "^${version}" to dependencies`));
    console.log(chalk.gray(`  run      pnpm install  to install`));
  } else {
    console.log(chalk.gray(`  sna already in package.json`));
  }
  console.log();
  cmdLink();
}
