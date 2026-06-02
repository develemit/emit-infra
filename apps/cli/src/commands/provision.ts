import { Command } from 'commander'
import { join } from 'node:path'
import chalk from 'chalk'
import { loadConfig, runTerraform } from '@emit-infra/core'

export function registerProvision(program: Command): void {
  program
    .command('provision [name]')
    .description('Run terraform apply to provision all infrastructure')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--plan-only', 'Run terraform plan without applying')
    .action(async (_name: string | undefined, opts: { config?: string; planOnly?: boolean }) => {
      const config = loadConfig(opts.config)
      const tfDir = join(process.cwd(), 'terraform')

      console.log(chalk.cyan(`Provisioning infrastructure for ${chalk.bold(config.name)}...`))

      await runTerraform('init', [], tfDir)

      if (opts.planOnly) {
        await runTerraform('plan', [], tfDir)
      } else {
        await runTerraform('apply', ['-auto-approve'], tfDir)
        console.log(chalk.green(`\nDone. Run "emit-infra configure ${config.name}" next.`))
      }
    })
}
