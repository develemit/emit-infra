import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { execa } from 'execa'
import chalk from 'chalk'
import {
  loadConfig,
  sshExec,
  classifyRunState,
  getTerraformOutput,
  evaluateGateStaleness,
  type DeployStatusRecord,
  type RunState,
  type GateStalenessResult,
} from '@emit-infra/core'

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

interface UnpushedGitInfo {
  count: number
  newestCommitAt: string | null
}

// Sprint 299: deliberately reads the local `origin/main` ref rather than
// fetching first. `status` is meant to be a fast, no-network local check —
// pairing it with an implicit `git fetch` would slow every invocation down
// for a comparison that's only ever advisory. formatGateStalenessLine always
// says which ref it used so a stale local ref can't masquerade as a live one.
async function getUnpushedGitInfo(cwd: string): Promise<UnpushedGitInfo | null> {
  const result = await execa('git', ['log', 'origin/main..HEAD', '--format=%cI'], { cwd, reject: false })
  if (result.exitCode !== 0) return null
  const commitDates = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  return { count: commitDates.length, newestCommitAt: commitDates[0] ?? null }
}

export function formatGateStalenessLine(verdict: GateStalenessResult): string | null {
  if (verdict.reason === 'no-unpushed') return null
  const color = verdict.warn ? chalk.yellow : chalk.dim
  return `  Push gate: ${color(verdict.detail)} ${chalk.dim(`(${verdict.unpushedCount} unpushed, vs cached origin/main — no fetch)`)}`
}

async function printLocalPipelineState(cwd: string): Promise<void> {
  const [ci, deploy] = await Promise.all([
    readLocalStatusRecord(cwd, '.ci-status.json'),
    readLocalStatusRecord(cwd, '.deploy-status.json'),
  ])
  console.log(chalk.cyan('Local pipeline (this machine):'))
  console.log(formatPipelineLine('CI    ', ci))
  console.log(formatPipelineLine('Deploy', deploy))

  const gitInfo = await getUnpushedGitInfo(cwd)
  if (gitInfo) {
    const verdict = evaluateGateStaleness({ unpushedCount: gitInfo.count, newestUnpushedCommitAt: gitInfo.newestCommitAt, ciRecord: ci })
    const line = formatGateStalenessLine(verdict)
    if (line) console.log(line)
  }

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
