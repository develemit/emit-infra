import { classifyRunState, type DeployStatusRecord } from './deploy-status.js'

// Sprint 299: turns "N unpushed commits + the newest .ci-status.json record"
// into a warn/quiet verdict — the signal that would have caught tastease
// sitting on a broken gate for 9 days and 102 commits. Commit count alone is
// the wrong signal (develemail carries 51 unpushed commits on a perfectly
// healthy gate); what predicts a rejected push is staleness of the *last
// run* relative to the work that's piled up since. See the sprint file for
// the fleet measurements this rule was tuned against.

export type GateStalenessReason =
  | 'no-unpushed'
  | 'never-run'
  | 'stale'
  | 'failed'
  | 'orphaned-run'
  | 'running'
  | 'fresh-success'

export interface GateStalenessInput {
  /** `git rev-list --count origin/main..HEAD` (or equivalent). */
  unpushedCount: number
  /** ISO timestamp of the newest unpushed commit, or null if unknown. */
  newestUnpushedCommitAt: string | null
  /** Parsed `.ci-status.json`, or null if the file doesn't exist. */
  ciRecord: DeployStatusRecord | null
  now?: number
}

export interface GateStalenessResult {
  warn: boolean
  reason: GateStalenessReason
  detail: string
  unpushedCount: number
  lastRunAt: string | null
  lastRunStatus: string | null
}

function isStale(lastRunAt: string | undefined, newestUnpushedCommitAt: string | null): boolean {
  const runTime = lastRunAt ? Date.parse(lastRunAt) : NaN
  const commitTime = newestUnpushedCommitAt ? Date.parse(newestUnpushedCommitAt) : NaN
  // Either timestamp being unparseable means freshness can't be proven —
  // treat that as stale rather than silently trusting an unverifiable record.
  if (Number.isNaN(runTime) || Number.isNaN(commitTime)) return true
  return runTime < commitTime
}

/** The one place that decides whether a project's push gate has gone stale
 * while unpushed commits piled up. Reuses sprint 284's classifyRunState for
 * the in-flight/orphaned distinction instead of reimplementing a second
 * staleness heuristic — see that module's doc comment for why. */
export function evaluateGateStaleness(input: GateStalenessInput): GateStalenessResult {
  const { unpushedCount, newestUnpushedCommitAt, ciRecord, now } = input
  const lastRunAt = ciRecord?.startedAt ?? null
  const lastRunStatus = ciRecord?.status ?? null

  if (unpushedCount <= 0) {
    return { warn: false, reason: 'no-unpushed', detail: 'no unpushed commits', unpushedCount, lastRunAt, lastRunStatus }
  }

  if (!ciRecord) {
    return {
      warn: true,
      reason: 'never-run',
      detail: `${unpushedCount} unpushed commit(s) and the push gate has never run (.ci-status.json not found)`,
      unpushedCount,
      lastRunAt,
      lastRunStatus,
    }
  }

  const runState = classifyRunState(ciRecord, now === undefined ? {} : { now })

  if (runState.state === 'running') {
    return { warn: false, reason: 'running', detail: 'the gate is currently running', unpushedCount, lastRunAt, lastRunStatus }
  }

  if (runState.state === 'orphaned' || runState.state === 'unknown') {
    return {
      warn: true,
      reason: 'orphaned-run',
      detail: `last gate run did not complete cleanly (${runState.reason})`,
      unpushedCount,
      lastRunAt,
      lastRunStatus,
    }
  }

  // runState.state === 'idle': a terminal record. classifyRunState collapses
  // success and failure into the same 'idle' bucket (it only distinguishes
  // in-flight vs not), so the actual outcome has to be read off record.status.
  if (ciRecord.status !== 'success') {
    return {
      warn: true,
      reason: 'failed',
      detail: `last gate run ended '${ciRecord.status ?? '(missing)'}'`,
      unpushedCount,
      lastRunAt,
      lastRunStatus,
    }
  }

  const completedAt = ciRecord.completedAt ?? ciRecord.startedAt
  if (isStale(completedAt, newestUnpushedCommitAt)) {
    return {
      warn: true,
      reason: 'stale',
      detail: `last successful gate run (${completedAt ?? 'unknown time'}) predates the newest unpushed commit`,
      unpushedCount,
      lastRunAt,
      lastRunStatus,
    }
  }

  return {
    warn: false,
    reason: 'fresh-success',
    detail: 'the gate ran successfully after the newest unpushed commit',
    unpushedCount,
    lastRunAt,
    lastRunStatus,
  }
}
