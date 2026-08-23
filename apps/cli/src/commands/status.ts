import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import chalk from 'chalk'
import { loadConfig, sshExec, classifyRunState, getTerraformOutput, type DeployStatusRecord, type RunState } from '@emit-infra/core'

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

const RUN_STATE_COLOR: Record<RunState, (s: string) => string> = {
  idle: chalk.dim,
  running: chalk.green,
  orphaned: chalk.red,
  unknown: chalk.yellow,
}

export async function readLocalStatusRecord(cwd: string, file: string): Promise<DeployStatusRecord | null> {
  try {
    const raw = await readFile(join(cwd, file), 'utf8')
    return JSON.parse(raw) as DeployStatusRecord
  } catch {
    return null
  }
}

// Uses the same classifier the API enriches its status routes with (sprint
// 284), so an operator answers "is it actually running?" the same way from
// the terminal as from the dashboard — no separate local heuristic.
export function formatPipelineLine(label: string, record: DeployStatusRecord | null): string {
  if (!record) return `  ${label}: ${chalk.dim('no local record')}`
  const result = classifyRunState(record)
  const color = RUN_STATE_COLOR[result.state]
  const progress = record.progress ? ` — ${record.progress.label} (${record.progress.pct}%)` : ''
  return `  ${label}: ${color(result.state)}${progress} ${chalk.dim(`(${result.reason})`)}`
}

async function printLocalPipelineState(cwd: string): Promise<void> {
  const [ci, deploy] = await Promise.all([
    readLocalStatusRecord(cwd, '.ci-status.json'),
    readLocalStatusRecord(cwd, '.deploy-status.json'),
  ])
  console.log(chalk.cyan('Local pipeline (this machine):'))
  console.log(formatPipelineLine('CI    ', ci))
  console.log(formatPipelineLine('Deploy', deploy))
  console.log()
}

export function registerStatus(program: Command): void {
  program
    .command('status [name]')
    .description('Local pipeline state plus SSH health check: uptime, disk, memory, container status')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--key <path>', 'Path to SSH private key', join(homedir(), '.ssh', 'emit-deploy'))
    .option('--host <ip>', 'Server IP (overrides terraform output lookup)')
    .action(async (_name: string | undefined, opts: { config?: string; key: string; host?: string }) => {
      const config = loadConfig(opts.config)

      console.log(chalk.cyan(`Status for ${chalk.bold(config.name)}\n`))
      await printLocalPipelineState(process.cwd())

      const host = opts.host ?? (await getTerraformOutput('server_ip', join(process.cwd(), 'terraform')))
      if (!host) {
        console.error(chalk.red('Could not determine server IP. Pass --host or run provision first.'))
        process.exit(1)
      }

      const appPort = config.deploy?.appPort ?? '3001'

      console.log(chalk.cyan(`Server (${host})\n`))

      const output = await sshExec(host, buildStatusScript(appPort), opts.key)
      console.log(output)
    })
}
