import { Command } from 'commander'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import chalk from 'chalk'
import { loadConfig, runTerraform } from '@emit-infra/core'

export function registerDestroy(program: Command): void {
  program
    .command('destroy [name]')
    .description('Destroy all Terraform-managed infrastructure for this project')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (_name: string | undefined, opts: { config?: string; yes?: boolean }) => {
      const config = loadConfig(opts.config)

      if (!opts.yes) {
        const confirmed = await confirm(
          chalk.red(
            `This will DESTROY all infrastructure for ${chalk.bold(config.name)}. Type the project name to confirm: `,
          ),
          config.name,
        )
        if (!confirmed) {
          console.log('Aborted.')
          return
        }
      }

      const tfDir = join(process.cwd(), 'terraform')
      await runTerraform('destroy', ['-auto-approve'], tfDir)
      console.log(chalk.green(`Infrastructure for ${config.name} destroyed.`))
    })
}

function confirm(prompt: string, expected: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim() === expected)
    })
  })
}
