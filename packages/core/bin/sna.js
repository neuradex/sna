#!/usr/bin/env node
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = resolve(__dirname, '../dist/scripts/sna.js')

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
