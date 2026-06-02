import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { loadConfig, sshExec } from '@emit-infra/core'

const STATUS_SCRIPT = [
  `echo "=== uptime ===" && uptime`,
  `echo "=== disk ===" && df -h /`,
  `echo "=== memory ===" && free -h`,
  `echo "=== containers ===" && docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`,
].join(' && ')

export function registerStatus(program: Command): void {
  program
    .command('status [name]')
    .description('SSH health check: uptime, disk, memory, container status')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--key <path>', 'Path to SSH private key', join(homedir(), '.ssh', 'emit-deploy'))
    .option('--host <ip>', 'Server IP (overrides terraform output lookup)')
    .action(async (_name: string | undefined, opts: { config?: string; key: string; host?: string }) => {
      const config = loadConfig(opts.config)

      const host = opts.host ?? (await getTerraformOutput('server_ip'))
      if (!host) {
        console.error(chalk.red('Could not determine server IP. Pass --host or run provision first.'))
        process.exit(1)
      }

      console.log(chalk.cyan(`Status for ${chalk.bold(config.name)} (${host})\n`))

      const output = await sshExec(host, STATUS_SCRIPT, opts.key)
      console.log(output)
    })
}

async function getTerraformOutput(key: string): Promise<string | null> {
  try {
    const { execa } = await import('execa')
    const result = await execa('terraform', ['-chdir=terraform', 'output', '-raw', key])
    return result.stdout.trim() || null
  } catch {
    return null
  }
}
