/**
 * sna CLI
 *
 * Commands:
 *   sna link     — create/update .claude/skills symlinks pointing to this package
 *   sna install  — add sna to package.json + run link
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// node_modules/sna/src/ → node_modules/sna/
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
${chalk.bold("sna")} — Skills-Native Application core primitives

${chalk.bold("Usage:")}
  sna link      Create/update .claude/skills symlinks
  sna install   Add sna to package.json and link skills
`);
}

function cmdLink() {
  const cwd = process.cwd();
  const claudeDir = path.join(cwd, ".claude");
  const skillsDir = path.join(claudeDir, "skills");

  // Ensure .claude/skills/ exists
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
    console.log(chalk.gray(`  created  .claude/skills/`));
  }

  const coreSkillsDir = path.join(PACKAGE_ROOT, "skills");
  if (!fs.existsSync(coreSkillsDir)) {
    console.error(chalk.red(`  ✗  sna skills directory not found: ${coreSkillsDir}`));
    process.exit(1);
  }

  const skills = fs.readdirSync(coreSkillsDir).filter((f) =>
    fs.statSync(path.join(coreSkillsDir, f)).isDirectory()
  );

  let linked = 0;
  let updated = 0;
  let skipped = 0;

  for (const skill of skills) {
    const linkPath = path.join(skillsDir, skill);
    // Relative path from .claude/skills/<skill> to node_modules/sna/skills/<skill>
    const target = path.relative(skillsDir, path.join(coreSkillsDir, skill));

    // Use try/catch with lstatSync to detect both existing files AND broken symlinks.
    // fs.existsSync returns false for broken symlinks, but lstatSync succeeds.
    let existing: fs.Stats | null = null;
    try {
      existing = fs.lstatSync(linkPath);
    } catch {
      // ENOENT — path does not exist at all (not even a broken symlink)
    }

    if (existing) {
      if (existing.isSymbolicLink()) {
        const currentTarget = fs.readlinkSync(linkPath);
        if (currentTarget === target) {
          skipped++;
          continue;
        }
        // Update outdated symlink
        fs.unlinkSync(linkPath);
        fs.symlinkSync(target, linkPath);
        console.log(chalk.cyan(`  updated  .claude/skills/${skill}/ → ${target}`));
        updated++;
      } else {
        // It's a real directory — don't overwrite, warn
        console.log(chalk.yellow(`  skipped  .claude/skills/${skill}/  (not a symlink — won't overwrite)`));
        skipped++;
      }
    } else {
      fs.symlinkSync(target, linkPath);
      console.log(chalk.green(`  linked   .claude/skills/${skill}/ → ${target}`));
      linked++;
    }
  }

  console.log();
  if (linked + updated > 0) {
    console.log(chalk.green(`✓  ${linked + updated} skill(s) linked`));
  } else {
    console.log(chalk.gray(`✓  Skills already up to date`));
  }
  if (skipped > 0 && linked + updated > 0) {
    console.log(chalk.gray(`   (${skipped} unchanged)`));
  }
}

function cmdInstall() {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    console.error(chalk.red("  ✗  No package.json found in current directory"));
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
