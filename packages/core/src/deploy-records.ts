import { execa } from 'execa'
import { readFile, writeFile, rename, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hostname } from 'node:os'

// Mirrors scripts/lib/ci-utils.sh's deploy_init/deploy_done so a CLI-side
// deploy (apps/cli/src/commands/deploy.ts) writes the same .deploy-status.json
// / .deploy-history.jsonl shape the pre-push hook writes — dashboards and
// resolve_last_deployed_sha (scripts/lib/deploy-launch.sh) don't care which
// path produced a record, only that the shape matches.
//
// The in-flight record also carries a "writer" block — pid/host/heartbeatAt
// (sprint 283) — so a reader can tell a live run from an orphaned one.
// Terminal records omit it, matching ci-utils.sh. The CLI deploy has no
// intermediate progress path (a single init → runAnsible → done bracket), so
// unlike the bash writer's deploy_step, there's no periodic refresh here —
// heartbeatAt is only ever the init timestamp.
//
// It also carries a "launch" block (sprint 290) — {mode, marker} — mirroring
// scripts/lib/deploy-launch.sh's deploy_launch_mode. Unlike "writer", "launch"
// survives onto terminal records: it's a fact about how the deploy started,
// not a liveness signal, so keeping it after completion is what makes it
// useful for a post-mortem.

const HISTORY_MAX_LINES = 1000
const HISTORY_KEEP_LINES = 500

// Same three values and marker list as scripts/lib/deploy-launch.sh's
// deploy_launch_mode / EMIT_UNATTENDED_SHELL_MARKERS — kept in sync by hand
// since one side is bash and the other TS. This CLI deploy path isn't gated
// by scripts/hooks/pre-push at all (it's invoked either directly by an
// operator or as a subprocess of the hook, which already ran its own gate),
// so this is purely a record-keeping stamp, not an enforcement point.
const UNATTENDED_SHELL_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CI'] as const

export interface DeployLaunch {
  mode: 'detached' | 'interactive' | 'unattended-override'
  marker: string
}

export function deployLaunchMode(env: NodeJS.ProcessEnv = process.env): DeployLaunch {
  const marker = UNATTENDED_SHELL_MARKERS.find((m) => Boolean(env[m])) ?? ''
  if (env.EMIT_DEPLOY_DETACHED === '1') return { mode: 'detached', marker }
  if (env.EMIT_ALLOW_UNATTENDED_DEPLOY === '1') return { mode: 'unattended-override', marker }
  return { mode: 'interactive', marker }
}

export interface DeployContext {
  sha: string
  branch: string
  message: string
  startedAt: string
  startedEpochMs: number
  launch: DeployLaunch
}

// Exported so deploy-reconcile.ts (sprint 286) can reuse the same atomic
// write / history truncation / iso-format shape rather than duplicating it —
// a reconciled record must be byte-shape-identical to one this module wrote.
export async function gitField(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execa('git', args, { cwd })
    return stdout.trim()
  } catch {
    return ''
  }
}

export function isoSeconds(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export async function writeAtomic(dest: string, content: string): Promise<void> {
  const tmp = `${dest}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, dest)
}

export async function truncateHistory(path: string): Promise<void> {
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
  const launch = deployLaunchMode()
  const ctx: DeployContext = { sha, branch, message, startedAt: isoSeconds(startedEpochMs), startedEpochMs, launch }

  await writeAtomic(
    join(cwd, '.deploy-status.json'),
    JSON.stringify({
      status: 'deploying',
      sha: ctx.sha,
      branch: ctx.branch,
      startedAt: ctx.startedAt,
      progress: { step: 0, total: 1, pct: 0, label: 'starting' },
      launch: ctx.launch,
      writer: { pid: process.pid, host: hostname(), heartbeatAt: ctx.startedAt },
    }) + '\n',
  )

  return ctx
}

// isBuildBaseline defaults to false: unlike the bash hook writer (ci-utils.sh
// deploy_done), this CLI path never builds or retags images itself — it
// deploys whatever tags already exist. A caller must explicitly prove the
// sha's images are what's actually running before claiming true; see
// deploy.ts's post-deploy verification (sprint 336) and
// resolve_last_deployed_sha (scripts/lib/deploy-launch.sh), which skips any
// record that isn't explicitly marked true.
export async function deployRecordDone(
  cwd: string,
  ctx: DeployContext,
  status: 'deployed' | 'failed',
  phases: Record<string, number> = {},
  isBuildBaseline = false,
): Promise<void> {
  const completedAt = isoSeconds(Date.now())
  const durationSec = Math.round((Date.now() - ctx.startedEpochMs) / 1000)

  await writeAtomic(
    join(cwd, '.deploy-status.json'),
    JSON.stringify({ status, sha: ctx.sha, branch: ctx.branch, completedAt, launch: ctx.launch, isBuildBaseline }) + '\n',
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
    launch: ctx.launch,
    message: ctx.message,
    isBuildBaseline,
  })
  await appendFile(historyPath, line + '\n')
  await truncateHistory(historyPath)
}
