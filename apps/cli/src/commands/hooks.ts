import { Command } from 'commander'
import { writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import { loadConfig } from '@emit-infra/core'
import { buildPreCommitHook } from '../lib/scaffold-hooks.js'

export function registerHooks(program: Command): void {
  program
    .command('hooks')
    .description('Scaffold .githooks/pre-commit for an existing project')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--force', 'Overwrite an existing pre-commit hook')
    .action((opts: { config?: string; force?: boolean }) => {
      const config = loadConfig(opts.config)

      const hooksDir = join(process.cwd(), '.githooks')
      if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true })

      const hookPath = join(hooksDir, 'pre-commit')
      if (existsSync(hookPath) && !opts.force) {
        console.log(chalk.yellow(`${hookPath} already exists. Use --force to overwrite.`))
        return
      }

      writeFileSync(hookPath, buildPreCommitHook(config))
      chmodSync(hookPath, 0o755)
      console.log(chalk.green(`Written .githooks/pre-commit`))
      console.log(chalk.cyan(`\nActivate with:`))
      console.log(`  git config core.hooksPath .githooks`)
    })
}
