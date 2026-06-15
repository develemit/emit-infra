import { Command } from 'commander'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import chalk from 'chalk'
import { loadConfig, runAnsible, type ProjectConfig } from '@emit-infra/core'

export function registerConfigure(program: Command): void {
  program
    .command('configure [name]')
    .description('Run full Ansible provision playbook against the server')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--inventory <path>', 'Path to Ansible inventory file (default: auto from terraform output)')
    .action(async (_name: string | undefined, opts: { config?: string; inventory?: string }) => {
      const config = loadConfig(opts.config)

      console.log(chalk.cyan(`Configuring server for ${chalk.bold(config.name)}...`))

      const inventory = opts.inventory ?? (await resolveInventoryPath(config.name, config))

      const extraVars: Record<string, unknown> = {
        project_name: config.name,
        domain: config.domain,
      }

      if (config.nginx?.wildcardCert) {
        extraVars.nginx_wildcard_cert = true
        const cfToken = process.env.TF_VAR_cloudflare_api_token
        if (!cfToken) {
          console.error(chalk.red('Error: TF_VAR_cloudflare_api_token must be set for wildcardCert DNS-01 challenge'))
          process.exit(1)
        }
        extraVars.cloudflare_api_token = cfToken
      }

      if (config.nginx?.customConfigSrc) {
        extraVars.nginx_custom_config_src = resolve(process.cwd(), config.nginx.customConfigSrc)
      }

      await runAnsible('provision', inventory, extraVars)

      console.log(chalk.green(`\nDone. Run "emit-infra deploy ${config.name}" to deploy the app.`))
    })
}

export async function resolveInventoryPath(projectName: string, config?: ProjectConfig): Promise<string> {
  const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')

  if (existsSync(inventoryPath)) return inventoryPath

  if (config?.serverIp) {
    const keyFile = `~/.ssh/${config.sshKeyName}`
    const { writeFileSync } = await import('node:fs')
    writeFileSync(inventoryPath, `[${projectName}]\n${config.serverIp} ansible_user=root ansible_ssh_private_key_file=${keyFile}\n`)
    return inventoryPath
  }

  const tfDir = join(process.cwd(), 'terraform')
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
