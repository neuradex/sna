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
 */

import fs from "fs";
import path from "path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: tsx scripts/set-version.ts <version>");
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, "..");

function updateJson(filePath: string, updater: (json: any) => void) {
  const abs = path.join(ROOT, filePath);
  const json = JSON.parse(fs.readFileSync(abs, "utf-8"));
  updater(json);
  fs.writeFileSync(abs, JSON.stringify(json, null, 2) + "\n");
  console.log(`  ✓ ${filePath} → ${version}`);
}

console.log(`Setting version to ${version}\n`);

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
