/**
 * set-version.ts — Sync version across all packages, plugin, and marketplace.
 *
 * Usage:
 *   tsx scripts/set-version.ts <version>
 *
 * Updates:
 *   - packages/core/package.json
 *   - packages/react/package.json
 *   - plugins/sna-builder/.claude-plugin/plugin.json
 *   - .claude-plugin/marketplace.json
 *
 * Validates:
 *   - semver format
 *   - version is higher than current
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const version = process.argv[2];
if (!version) {
  console.error("Usage: tsx scripts/set-version.ts <version>");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Validate semver format
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`✗ Invalid version format: "${version}". Expected semver (e.g., 1.0.0, 1.0.0-beta.1)`);
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");

// Parse semver for comparison (ignores pre-release for simplicity)
function parseSemver(v: string): [number, number, number] {
  const [major, minor, patch] = v.replace(/-.*$/, "").split(".").map(Number);
  return [major, minor, patch];
}

function isHigher(next: string, current: string): boolean {
  const [nMaj, nMin, nPat] = parseSemver(next);
  const [cMaj, cMin, cPat] = parseSemver(current);
  if (nMaj !== cMaj) return nMaj > cMaj;
  if (nMin !== cMin) return nMin > cMin;
  return nPat > cPat;
}

// Read current version from core package.json
const corePkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/core/package.json"), "utf-8"));
const currentVersion = corePkg.version;

if (currentVersion === version) {
  console.log(`Version already set to ${version} — skipping`);
  process.exit(0);
}

if (currentVersion !== "0.0.0" && !isHigher(version, currentVersion)) {
  console.error(`✗ Version ${version} is not higher than current ${currentVersion}`);
  process.exit(1);
}

function updateJson(filePath: string, updater: (json: any) => void) {
  const abs = path.join(ROOT, filePath);
  const json = JSON.parse(fs.readFileSync(abs, "utf-8"));
  updater(json);
  fs.writeFileSync(abs, JSON.stringify(json, null, 2) + "\n");
  console.log(`  ✓ ${filePath} → ${version}`);
}

console.log(`Setting version: ${currentVersion} → ${version}\n`);

// npm packages
updateJson("packages/core/package.json", (j) => { j.version = version; });
updateJson("packages/react/package.json", (j) => { j.version = version; });

// plugin
updateJson("plugins/sna-builder/.claude-plugin/plugin.json", (j) => { j.version = version; });

// marketplace
updateJson(".claude-plugin/marketplace.json", (j) => {
  for (const plugin of j.plugins) {
    plugin.version = version;
  }
});

console.log(`\n✓ All set to ${version}`);
