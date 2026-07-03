import { Command } from 'commander'
import chalk from 'chalk'
import { installHooks, uninstallHooks } from '../lib/scaffold-hooks.js'

export function registerHooks(program: Command): void {
  const hooks = program
    .command('hooks')
    .description('Install or remove shared pre-commit and pre-push hooks')

  hooks
    .command('install')
    .description('Symlink shared emit-infra hooks into this project')
    .option('--force', 'Overwrite existing hooks')
    .action((opts: { force?: boolean }) => {
      const { results, husky } = installHooks(process.cwd(), opts.force)

      for (const r of results) {
        if (r.action === 'linked' || r.action === 'replaced') {
          console.log(chalk.green(`${r.action === 'replaced' ? 'Replaced' : 'Linked'} ${r.path}`))
        } else {
          console.log(chalk.yellow(`${r.path} already exists — use --force to replace`))
        }
      }

      if (husky) {
        console.log(chalk.dim('\nHusky detected — hooks will run automatically.'))
      } else {
        console.log(chalk.cyan('\nActivate with:'))
        console.log('  git config core.hooksPath .githooks')
      }

      console.log(chalk.dim('\nHooks read ci config from .emit-infra.json — see "ci" section.'))
    })

  hooks
    .command('remove')
    .description('Remove emit-infra hook symlinks from this project')
    .action(() => {
      const removed = uninstallHooks(process.cwd())
      if (removed.length === 0) {
        console.log(chalk.yellow('No emit-infra hooks found to remove.'))
      } else {
        for (const hook of removed) {
          console.log(chalk.green(`Removed ${hook}`))
        }
      }
    })
}
