import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig } from '@emit-infra/core'
import { writePreCommitHook } from '../lib/scaffold-hooks.js'

export function registerHooks(program: Command): void {
  program
    .command('hooks')
    .description('Scaffold pre-commit hook for an existing project')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--force', 'Overwrite an existing pre-commit hook (non-Husky only)')
    .action((opts: { config?: string; force?: boolean }) => {
      const config = loadConfig(opts.config)
      const result = writePreCommitHook(process.cwd(), config, opts.force)

      if (!result.written) {
        console.log(chalk.yellow(`${result.path} already exists. Use --force to overwrite.`))
        return
      }

      console.log(chalk.green(`Written ${result.path}`))

      if (result.husky) {
        console.log(chalk.dim(`Husky detected — hook will run automatically on commit.`))
      } else {
        console.log(chalk.cyan(`\nActivate with:`))
        console.log(`  git config core.hooksPath .githooks`)
      }
    })
}
