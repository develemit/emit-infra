import { Command } from 'commander'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import chalk from 'chalk'
import { loadConfig, runTerraform } from '@emit-infra/core'

export function registerTerraformInit(program: Command): void {
  program
    .command('terraform-init [project]')
    .description(
      'Run terraform init with stored R2 backend credentials (from a prior emit-infra setup)',
    )
    .option('--config <path>', 'Path to .emit-infra.json')
    .action(async (project: string | undefined, opts: { config?: string }) => {
      const name = project ?? loadConfig(opts.config).name
      const tfDir = join(process.cwd(), 'terraform')

      if (!existsSync(tfDir)) {
        console.error(
          chalk.red(`No terraform/ directory found. Run "emit-infra init ${name}" first.`),
        )
        process.exit(1)
      }

      const credPath = join(homedir(), '.emit-infra', name, 'terraform-backend.env')

      if (!existsSync(credPath)) {
        console.error(chalk.red(`No stored backend credentials found at ${credPath}`))
        console.error(
          chalk.yellow(
            '\nRun "emit-infra setup" first to create the R2 state bucket and store credentials.',
          ),
        )
        process.exit(1)
      }

      console.log(chalk.bold(`Initialising Terraform for ${chalk.cyan(name)}...`))
      await runTerraform('init', ['-input=false', `-backend-config=${credPath}`], tfDir)
      console.log(chalk.green('\n  ✓ Terraform initialised — you can now run terraform plan/apply'))
    })
}
