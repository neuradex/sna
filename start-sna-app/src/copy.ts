import fs from 'fs'
import path from 'path'

const EXCLUDE = new Set([
  'node_modules',
  '.next',
  '.git',
  '.sna',
  'data',
  'pnpm-lock.yaml',
  'tsconfig.tsbuildinfo',
  'next-env.d.ts',
  '.DS_Store',
])

const EXCLUDE_EXTENSIONS = new Set(['.log'])

function shouldExclude(name: string): boolean {
  return EXCLUDE.has(name) || EXCLUDE_EXTENSIONS.has(path.extname(name))
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    if (shouldExclude(entry.name)) continue

    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export function copyTemplate(templateDir: string, targetDir: string): void {
  copyDir(templateDir, targetDir)
}

export function rewritePackageName(targetDir: string, projectName: string): void {
  const pkgPath = path.join(targetDir, 'package.json')
  if (!fs.existsSync(pkgPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  pkg.name = projectName
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}
