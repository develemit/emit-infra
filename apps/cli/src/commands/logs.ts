import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { loadConfig, sshExec } from '@emit-infra/core'

function buildLogsScript(
  container: string | undefined,
  lines: string,
  since: string | undefined,
  errors: boolean
): string {
  const baseLines = errors ? '500' : lines

  if (container) {
    // Single container
    let cmd = `docker logs --tail ${baseLines}`
    if (since) {
      cmd += ` --since ${since}`
    }
    cmd += ` ${container} 2>&1`
    if (errors) {
      cmd += ` | grep -iE 'error|warn|fatal|exception|panic|traceback'`
    }
    return cmd
  } else {
    // All containers
    const logCmd = `docker logs --tail ${baseLines}${since ? ` --since ${since}` : ''} $name 2>&1`
    const filterCmd = errors ? ` | grep -iE 'error|warn|fatal|exception|panic|traceback'` : ''
    return `docker ps --format '{{.Names}}' | while read name; do echo "=== $name ==="; ${logCmd}${filterCmd}; done`
  }
}

export function registerLogs(program: Command): void {
  program
    .command('logs [container]')
    .description('SSH fetch Docker container logs with filtering options')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--key <path>', 'Path to SSH private key', join(homedir(), '.ssh', 'emit-deploy'))
    .option('--host <ip>', 'Server IP (overrides terraform output lookup)')
    .option('--lines <n>', 'Number of log lines to fetch', '100')
    .option('--since <duration>', 'Time window (e.g. 1h, 30m)')
    .option('--errors', 'Filter to error-like lines only', false)
    .action(
      async (
        container: string | undefined,
        opts: {
          config?: string
          key: string
          host?: string
          lines: string
          since?: string
          errors: boolean
        }
      ) => {
        const config = loadConfig(opts.config)

        const host = opts.host ?? (await getTerraformOutput('server_ip'))
        if (!host) {
          console.error(chalk.red('Could not determine server IP. Pass --host or run provision first.'))
          process.exit(1)
        }

        console.log(chalk.cyan(`Logs for ${chalk.bold(config.name)} (${host})\n`))

        const output = await sshExec(host, buildLogsScript(container, opts.lines, opts.since, opts.errors), opts.key)
        console.log(output)
      }
    )
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
