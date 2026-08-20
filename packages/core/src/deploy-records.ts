import { execa } from 'execa'
import { readFile, writeFile, rename, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hostname } from 'node:os'

// Mirrors scripts/lib/ci-utils.sh's deploy_init/deploy_done so a CLI-side
// deploy (apps/cli/src/commands/deploy.ts) writes the same .deploy-status.json
// / .deploy-history.jsonl shape the pre-push hook writes — dashboards and
// resolve_last_deployed_sha (scripts/lib/deploy-plan.sh) don't care which
// path produced a record, only that the shape matches.
//
// The in-flight record also carries a "writer" block — pid/host/heartbeatAt
// (sprint 283) — so a reader can tell a live run from an orphaned one.
// Terminal records omit it, matching ci-utils.sh. The CLI deploy has no
// intermediate progress path (a single init → runAnsible → done bracket), so
// unlike the bash writer's deploy_step, there's no periodic refresh here —
// heartbeatAt is only ever the init timestamp.

const HISTORY_MAX_LINES = 1000
const HISTORY_KEEP_LINES = 500

export interface DeployContext {
  sha: string
  branch: string
  message: string
  startedAt: string
  startedEpochMs: number
}

async function gitField(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execa('git', args, { cwd })
    return stdout.trim()
  } catch {
    return ''
  }
}

function isoSeconds(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function writeAtomic(dest: string, content: string): Promise<void> {
  const tmp = `${dest}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, dest)
}

async function truncateHistory(path: string): Promise<void> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return
  }
  const lines = content.split('\n').filter((l) => l.length > 0)
  if (lines.length <= HISTORY_MAX_LINES) return
  await writeAtomic(path, lines.slice(-HISTORY_KEEP_LINES).join('\n') + '\n')
}

export async function deployRecordInit(cwd: string): Promise<DeployContext> {
  const [sha, branch, message] = await Promise.all([
    gitField(cwd, ['rev-parse', 'HEAD']),
    gitField(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitField(cwd, ['log', '-1', '--format=%s', 'HEAD']),
  ])
  const startedEpochMs = Date.now()
  const ctx: DeployContext = { sha, branch, message, startedAt: isoSeconds(startedEpochMs), startedEpochMs }

  await writeAtomic(
    join(cwd, '.deploy-status.json'),
    JSON.stringify({
      status: 'deploying',
      sha: ctx.sha,
      branch: ctx.branch,
      startedAt: ctx.startedAt,
      progress: { step: 0, total: 1, pct: 0, label: 'starting' },
      writer: { pid: process.pid, host: hostname(), heartbeatAt: ctx.startedAt },
    }) + '\n',
  )

  return ctx
}

export async function deployRecordDone(
  cwd: string,
  ctx: DeployContext,
  status: 'deployed' | 'failed',
  phases: Record<string, number> = {},
): Promise<void> {
  const completedAt = isoSeconds(Date.now())
  const durationSec = Math.round((Date.now() - ctx.startedEpochMs) / 1000)

  await writeAtomic(
    join(cwd, '.deploy-status.json'),
    JSON.stringify({ status, sha: ctx.sha, branch: ctx.branch, completedAt }) + '\n',
  )

  const historyPath = join(cwd, '.deploy-history.jsonl')
  const line = JSON.stringify({
    status,
    sha: ctx.sha,
    branch: ctx.branch,
    startedAt: ctx.startedAt,
    completedAt,
    durationSec,
    servicesBuilt: [],
    phases,
    message: ctx.message,
  })
  await appendFile(historyPath, line + '\n')
  await truncateHistory(historyPath)
}
