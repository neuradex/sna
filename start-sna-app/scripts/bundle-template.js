#!/usr/bin/env node
// Bundles templates into templates/<name>/ before npm publish
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const EXCLUDE = new Set([
  'node_modules', '.next', '.git', '.sna', 'data',
  'pnpm-lock.yaml', 'tsconfig.tsbuildinfo', 'next-env.d.ts', '.DS_Store',
])
const EXCLUDE_EXT = new Set(['.log'])

function copy(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name) || EXCLUDE_EXT.has(path.extname(entry.name))) continue
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    entry.isDirectory() ? copy(s, d) : fs.copyFileSync(s, d)
  }
}

const TEMPLATES = [
  {
    name: 'blank',
    src: path.resolve(__dirname, '../../skills-native-app'),
  },
  {
    name: 'devlog',
    src: path.resolve(__dirname, '../../sna-templates/devlog'),
  },
]

const DEST_ROOT = path.resolve(__dirname, '../templates')
if (fs.existsSync(DEST_ROOT)) fs.rmSync(DEST_ROOT, { recursive: true })

for (const t of TEMPLATES) {
  if (!fs.existsSync(t.src)) {
    console.warn(`⚠ Skipping "${t.name}": source not found at ${t.src}`)
    continue
  }
  const dest = path.join(DEST_ROOT, t.name)
  copy(t.src, dest)
  console.log(`✅ Bundled "${t.name}" → templates/${t.name}/`)
}
