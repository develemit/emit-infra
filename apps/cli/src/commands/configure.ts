import { Command } from 'commander'
import { join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import chalk from 'chalk'
import { loadConfig, runAnsible, getTerraformOutput, type ProjectConfig } from '@emit-infra/core'

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

      if (config.nginx?.apiPathPrefix && config.nginx?.apiUpstream) {
        extraVars.nginx_api_path_prefix = config.nginx.apiPathPrefix
        extraVars.nginx_api_upstream = config.nginx.apiUpstream
      }

      await runAnsible('provision', inventory, extraVars)

      console.log(chalk.green(`\nDone. Run "emit-infra deploy ${config.name}" to deploy the app.`))
    })
}

/**
 * Extracts the distinct host tokens from an Ansible inventory file's content.
 * Skips comments, blank lines, and `[group]` headers; ignores everything
 * after the host token on each line (ansible_user=, ansible_ssh_*=, etc).
 * Multiple groups pointing at the same host collapse to one entry.
 */
export function parseInventoryHosts(content: string): string[] {
  const hosts = new Set<string>()
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('[')) continue
    const host = line.split(/\s+/)[0]
    if (host) hosts.add(host)
  }
  return [...hosts]
}

/**
 * Refuses to proceed when an existing inventory file's host disagrees with
 * the project's known server address — the only gap that fails silently
 * against the wrong machine (see docs/ops/emit-infra-upstream-findings.md).
 * `--inventory <path>` bypasses this function entirely at the call site.
 */
async function validateInventory(inventoryPath: string, projectName: string, config?: ProjectConfig): Promise<void> {
  const hosts = parseInventoryHosts(readFileSync(inventoryPath, 'utf8'))

  if (hosts.length > 1) {
    throw new Error(
      `${inventoryPath} lists multiple hosts (${hosts.join(', ')}) — refusing to guess which one ` +
      `${projectName} should target. Trim the file to a single host, or pass --inventory <path> to select explicitly.`,
    )
  }

  const foundHost = hosts[0]
  if (!foundHost) return

  let expectedHost = config?.serverIp
  let expectedSource = 'config.serverIp'
  if (!expectedHost) {
    const tfDir = join(process.cwd(), 'terraform')
    expectedHost = (await getTerraformOutput('server_ip', tfDir)) ?? undefined
    expectedSource = "terraform output 'server_ip'"
  }

  if (!expectedHost) {
    console.log(chalk.yellow(
      `Note: no config.serverIp and no Terraform output for ${projectName} — skipping inventory validation for ${inventoryPath}.`,
    ))
    return
  }

  if (foundHost !== expectedHost) {
    throw new Error(
      `Ansible inventory mismatch for ${projectName}: ${inventoryPath} targets ${foundHost}, but the ` +
      `expected server is ${expectedHost} (from ${expectedSource}). Refusing to run against a possibly ` +
      `wrong server — this file may belong to a different project or a destroyed/reassigned host. ` +
      `Fix or delete ${inventoryPath}, or pass --inventory <path> to override deliberately.`,
    )
  }
}

export async function resolveInventoryPath(projectName: string, config?: ProjectConfig): Promise<string> {
  const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')

  if (existsSync(inventoryPath)) {
    await validateInventory(inventoryPath, projectName, config)
    return inventoryPath
  }

  if (config?.serverIp) {
    const keyFile = `~/.ssh/${config.sshKeyName}`
    const { writeFileSync } = await import('node:fs')
    writeFileSync(inventoryPath, `[${projectName}]\n${config.serverIp} ansible_user=root ansible_ssh_private_key_file=${keyFile}\n`)
    return inventoryPath
  }

  const tfDir = join(process.cwd(), 'terraform')
  const ip = await getTerraformOutput('server_ip', tfDir)
  if (!ip) {
    throw new Error(
      `Could not determine server IP. Pass --inventory or run "emit-infra provision" first.`,
    )
  }
  const { writeFileSync } = await import('node:fs')
  writeFileSync(inventoryPath, `[${projectName}]\n${ip}\n`)
  return inventoryPath
}
