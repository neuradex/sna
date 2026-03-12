#!/usr/bin/env node
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = resolve(__dirname, '../src/cli.ts')
const tsx = resolve(__dirname, '../node_modules/.bin/tsx')

const child = spawn(tsx, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
