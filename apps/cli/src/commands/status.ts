import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { loadConfig, sshExec } from '@emit-infra/core'

function buildStatusScript(appPort: string): string {
  return [
    `echo "=== uptime ===" && uptime`,
    `echo "=== disk ===" && df -h /`,
    `echo "=== memory ===" && free -h`,
    `echo "=== containers ===" && docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`,
    `echo "=== healthz (port ${appPort}) ==="`,
    `curl -sf --max-time 3 http://localhost:${appPort}/healthz | python3 -m json.tool 2>/dev/null || echo "(healthz unavailable — add /healthz to the API or set deploy.appPort in .emit-infra.json)"`,
  ].join(' && ')
}

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

      const appPort = config.deploy?.appPort ?? '3001'

      console.log(chalk.cyan(`Status for ${chalk.bold(config.name)} (${host})\n`))

      const output = await sshExec(host, buildStatusScript(appPort), opts.key)
      console.log(output)
    })
}

export async function getTerraformOutput(key: string): Promise<string | null> {
  try {
    const { execa } = await import('execa')
    // `-json` (not `-raw <key>`) so an empty state parses to `{}` instead of
    // dumping a "No outputs found" warning onto stdout with exit code 0 —
    // `-raw` on a project with no outputs corrupted the SSH hostname with
    // that warning text (observed on diner-decider, sprint 258).
    const result = await execa('terraform', ['-chdir=terraform', 'output', '-json'])
    const outputs = JSON.parse(result.stdout) as Record<string, { value?: unknown }>
    const value = outputs[key]?.value
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}
