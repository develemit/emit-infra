import { readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifyRunState, ORPHANED_STATUS, type DeployStatusRecord } from './deploy-status.js'
import { gitField, isoSeconds, writeAtomic, truncateHistory } from './deploy-records.js'

// Repair half of sprint 286: given a project directory, decide whether its
// .ci-status.json / .deploy-status.json is a genuinely orphaned record (per
// classifyRunState, sprint 284's sole staleness rule) and, if so, build the
// terminal record + history line that clears it — shape-identical to what
// ci_done/deploy_done (scripts/lib/ci-utils.sh) and deployRecordDone
// (deploy-records.ts) already write, so a reconciled record can't be told
// apart from a normally-written one except by its `status` value.

export type ReconcileKind = 'ci' | 'deploy'

const KIND_FILES: Record<ReconcileKind, { statusFile: string; historyFile: string }> = {
  ci: { statusFile: '.ci-status.json', historyFile: '.ci-history.jsonl' },
  deploy: { statusFile: '.deploy-status.json', historyFile: '.deploy-history.jsonl' },
}

export interface ReconcilePlan {
  kind: ReconcileKind
  cwd: string
  action: 'reconcile' | 'skip'
  reason: string
  statusPath: string
  historyPath?: string
  terminalRecord?: Record<string, unknown>
  historyLine?: Record<string, unknown>
}

function skip(kind: ReconcileKind, cwd: string, statusPath: string, reason: string): ReconcilePlan {
  return { kind, cwd, action: 'skip', reason, statusPath }
}

async function readStatusRecord(statusPath: string): Promise<DeployStatusRecord | { error: string }> {
  let raw: string
  try {
    raw = await readFile(statusPath, 'utf8')
  } catch {
    return { error: 'not found' }
  }
  try {
    return JSON.parse(raw) as DeployStatusRecord
  } catch {
    return { error: 'not valid JSON' }
  }
}

// Read-only: decides what a reconcile *would* do without touching disk.
// Dry-run is the default caller behavior (see reconcile.ts) — this is what
// makes that possible.
export async function planReconcile(
  cwd: string,
  kind: ReconcileKind,
  opts: { now?: number } = {},
): Promise<ReconcilePlan> {
  const { statusFile, historyFile } = KIND_FILES[kind]
  const statusPath = join(cwd, statusFile)
  const historyPath = join(cwd, historyFile)
  const now = opts.now ?? Date.now()

  const record = await readStatusRecord(statusPath)
  if ('error' in record) return skip(kind, cwd, statusPath, `${statusFile} ${record.error}`)

  const result = classifyRunState(record, { now })
  if (result.state !== 'orphaned') {
    return skip(kind, cwd, statusPath, `classified as '${result.state}' (${result.reason}) — not orphaned`)
  }

  const completedAt = isoSeconds(now)
  const startedAt = record.startedAt ?? completedAt
  const startedMs = Date.parse(startedAt)
  const durationSec = Number.isNaN(startedMs) ? 0 : Math.max(0, Math.round((now - startedMs) / 1000))
  const sha = record.sha ?? ''
  const branch = record.branch ?? ''
  const message = sha ? await gitField(cwd, ['log', '-1', '--format=%s', sha]) : ''

  const terminalRecord = { status: ORPHANED_STATUS, sha, branch, completedAt }
  const historyLine =
    kind === 'deploy'
      ? { status: ORPHANED_STATUS, sha, branch, startedAt, completedAt, durationSec, servicesBuilt: [], phases: {}, message }
      : { status: ORPHANED_STATUS, sha, branch, startedAt, completedAt, durationSec, message }

  return {
    kind,
    cwd,
    action: 'reconcile',
    reason: `orphaned (${result.reason})`,
    statusPath,
    historyPath,
    terminalRecord,
    historyLine,
  }
}

// Mutating half — only called under --write. Writes the terminal record and
// appends exactly one history line, reusing deploy-records.ts's atomic-write
// and truncation helpers so a reconciled file follows the same rotation
// policy as every other writer.
export async function applyReconcile(plan: ReconcilePlan): Promise<void> {
  if (plan.action !== 'reconcile' || !plan.terminalRecord || !plan.historyPath || !plan.historyLine) return
  await writeAtomic(plan.statusPath, JSON.stringify(plan.terminalRecord) + '\n')
  await appendFile(plan.historyPath, JSON.stringify(plan.historyLine) + '\n')
  await truncateHistory(plan.historyPath)
}
