import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'
import chalk from 'chalk'
import ora from 'ora'
import { copyTemplate, rewritePackageName } from './copy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface Template {
  id: string
  label: string
  desc: string
  localPath: string
  bundledPath: string
}

const TEMPLATES: Template[] = [
  {
    id: 'blank',
    label: 'blank',
    desc: 'Minimal SNA app — terminal panel + skill event stream, nothing else',
    localPath: path.resolve(__dirname, '../../skills-native-app'),
    bundledPath: path.resolve(__dirname, '../templates/blank'),
  },
  {
    id: 'devlog',
    label: 'devlog',
    desc: 'Git activity tracker — collects commits, analyzes with Claude, shows dashboard',
    localPath: path.resolve(__dirname, '../../sna-templates/devlog'),
    bundledPath: path.resolve(__dirname, '../templates/devlog'),
  },
]

function resolveTemplateDir(t: Template): string {
  if (fs.existsSync(t.bundledPath)) return t.bundledPath
  if (fs.existsSync(t.localPath)) return t.localPath
  throw new Error(`Template directory not found for "${t.id}"`)
}

function rl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout })
}

async function ask(question: string): Promise<string> {
  const iface = rl()
  return new Promise((resolve) => {
    iface.question(question, (answer) => {
      iface.close()
      resolve(answer.trim())
    })
  })
}

async function confirm(question: string): Promise<boolean> {
  const answer = await ask(question)
  return answer.toLowerCase() === 'y'
}

async function selectTemplate(): Promise<Template> {
  console.log(chalk.bold('Select a template:'))
  console.log()

  TEMPLATES.forEach((t, i) => {
    const num = chalk.cyan(`  ${i + 1}.`)
    const label = chalk.white(t.label.padEnd(10))
    console.log(`${num} ${label}  ${chalk.white(t.desc)}`)
  })

  console.log()

  while (true) {
    const raw = await ask(chalk.white(`Enter number (1–${TEMPLATES.length}): `))
    const n = parseInt(raw, 10)
    if (n >= 1 && n <= TEMPLATES.length) {
      return TEMPLATES[n - 1]
    }
    console.log(chalk.yellow(`  Please enter a number between 1 and ${TEMPLATES.length}`))
  }
}

async function main() {
  const projectName = process.argv[2] ?? 'my-sna-app'
  const targetDir = path.resolve(process.cwd(), projectName)

  console.log()
  console.log(chalk.bold(`Creating ${chalk.cyan(projectName)}...`))
  console.log()

  const template = await selectTemplate()
  console.log()

  let templateDir: string
  try {
    templateDir = resolveTemplateDir(template)
  } catch (err) {
    console.error(chalk.red(String(err)))
    process.exit(1)
  }

  if (fs.existsSync(targetDir)) {
    const ok = await confirm(
      chalk.yellow(`Directory "${projectName}" already exists. Overwrite? (y/N) `)
    )
    if (!ok) {
      console.log(chalk.red('Aborted.'))
      process.exit(1)
    }
  }

  const spinner = ora('Copying template...').start()
  try {
    copyTemplate(templateDir, targetDir)
    rewritePackageName(targetDir, projectName)
    spinner.succeed(`Template "${template.label}" copied`)
  } catch (err) {
    spinner.fail('Copy failed')
    console.error(err)
    process.exit(1)
  }

  console.log()
  console.log(chalk.green(`✅ Created ${chalk.bold(projectName)}`))
  console.log()
  console.log('Next steps:')
  console.log(chalk.cyan(`  cd ${projectName}`))
  console.log(chalk.cyan('  pnpm install'))
  console.log(chalk.cyan('  claude') + chalk.gray('          # Open Claude Code, then type /sna-up'))
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
