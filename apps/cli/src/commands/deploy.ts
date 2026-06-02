import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig, runAnsible } from '@emit-infra/core'
import { resolveInventoryPath } from './configure.js'

export function registerDeploy(program: Command): void {
  program
    .command('deploy [name]')
    .description('Pull latest images and restart the app (Ansible deploy playbook)')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--inventory <path>', 'Path to Ansible inventory file')
    .action(async (_name: string | undefined, opts: { config?: string; inventory?: string }) => {
      const config = loadConfig(opts.config)

      console.log(chalk.cyan(`Deploying ${chalk.bold(config.name)}...`))

      const inventory = opts.inventory ?? (await resolveInventoryPath(config.name))

      await runAnsible('deploy', inventory, { project_name: config.name })

      console.log(chalk.green(`\nDeployed successfully.`))
    })
}
