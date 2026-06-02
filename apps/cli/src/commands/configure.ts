import { Command } from 'commander'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import chalk from 'chalk'
import { loadConfig, runAnsible } from '@emit-infra/core'

export function registerConfigure(program: Command): void {
  program
    .command('configure [name]')
    .description('Run full Ansible provision playbook against the server')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--inventory <path>', 'Path to Ansible inventory file (default: auto from terraform output)')
    .action(async (_name: string | undefined, opts: { config?: string; inventory?: string }) => {
      const config = loadConfig(opts.config)

      console.log(chalk.cyan(`Configuring server for ${chalk.bold(config.name)}...`))

      const inventory = opts.inventory ?? (await resolveInventoryPath(config.name))

      await runAnsible('provision', inventory, { project_name: config.name, domain: config.domain })

      console.log(chalk.green(`\nDone. Run "emit-infra deploy ${config.name}" to deploy the app.`))
    })
}

export async function resolveInventoryPath(projectName: string): Promise<string> {
  const tfDir = join(process.cwd(), 'terraform')
  const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')

  if (existsSync(inventoryPath)) return inventoryPath

  // Try to get IP from terraform output
  try {
    const { execa } = await import('execa')
    const result = await execa('terraform', ['-chdir=' + tfDir, 'output', '-raw', 'server_ip'])
    const ip = result.stdout.trim()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(inventoryPath, `[${projectName}]\n${ip}\n`)
    return inventoryPath
  } catch {
    throw new Error(
      `Could not determine server IP. Pass --inventory or run "emit-infra provision" first.`,
    )
  }
}
