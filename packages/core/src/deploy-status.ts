import { hostname } from 'node:os'

// Reader side of the status-file contract sprint 283's writers implement:
// scripts/lib/ci-utils.sh (ci_init/ci_step/deploy_init/deploy_step) and
// deploy-records.ts's deployRecordInit both write a "writer":{pid,host,
// heartbeatAt} block on every in-flight record, and omit it on terminal
// records. This module is the *only* place that turns that block into a
// verdict — apps/api's routes and apps/cli's status command both call
// classifyRunState instead of inventing their own staleness heuristic, so
// the dashboard, the terminal, and any future reader can't disagree about
// whether a deploy is actually running.

export interface DeployWriterInfo {
  pid: number
  host: string
  heartbeatAt: string
}

// The union of what .ci-status.json and .deploy-status.json can hold, across
// both the in-flight shape (status/progress/writer) and the terminal shape
// (status/completedAt, no writer). Fields are optional because a malformed
// or partial file must classify to 'unknown' rather than throw.
export interface DeployStatusRecord {
  status?: string
  sha?: string
  branch?: string
  startedAt?: string
  completedAt?: string
  progress?: { step: number; total: number; pct: number; label: string }
  writer?: DeployWriterInfo
}

export type RunState = 'idle' | 'running' | 'orphaned' | 'unknown'

export interface RunStateResult {
  state: RunState
  reason: string
  heartbeatAgeSec: number | null
  pidAlive: boolean | null
  sameHost: boolean | null
}

export interface ClassifyRunStateOptions {
  now?: number
  currentHost?: string
  isPidAlive?: (pid: number) => boolean
}

const IN_FLIGHT_STATUSES = new Set(['running', 'deploying'])

// The bash refresher ticks every 30s (see _emit_start_heartbeat). Two missed
// ticks would already be suspicious; 4x gives scheduling jitter and a slow
// disk write room without flagging a merely-busy build as orphaned, while
// still catching a truly dead writer within ~2 minutes instead of letting a
// stuck record sit there indefinitely.
export const HEARTBEAT_INTERVAL_SEC = 30
export const ORPHAN_HEARTBEAT_THRESHOLD_SEC = HEARTBEAT_INTERVAL_SEC * 4

// Pre-283 records carry no writer block at all, so there's no heartbeat to
// judge freshness by — only "how long has this claimed to be running." A
// real deploy/CI run is minutes, not tens of minutes, so an in-flight record
// this old with zero liveness evidence is treated as orphaned; anything
// younger is 'unknown' rather than a guess in either direction.
export const UNKNOWN_RECORD_ORPHAN_AGE_SEC = 30 * 60

function ageSec(iso: string | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.round((now - t) / 1000)
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it only checks whether the pid exists and is
    // ours to signal. EPERM means it exists but belongs to another user —
    // still alive, just not ours.
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function classifyByAgeOnly(record: DeployStatusRecord, now: number): RunStateResult {
  const startedAgeSec = ageSec(record.startedAt, now)
  if (startedAgeSec === null) {
    return {
      state: 'unknown',
      reason: 'no writer block and no parseable startedAt',
      heartbeatAgeSec: null,
      pidAlive: null,
      sameHost: null,
    }
  }
  if (startedAgeSec > UNKNOWN_RECORD_ORPHAN_AGE_SEC) {
    return {
      state: 'orphaned',
      reason: `no writer block (pre-283 record) and started ${startedAgeSec}s ago, past the ${UNKNOWN_RECORD_ORPHAN_AGE_SEC}s no-evidence threshold`,
      heartbeatAgeSec: null,
      pidAlive: null,
      sameHost: null,
    }
  }
  return {
    state: 'unknown',
    reason: 'no writer block (pre-283 record); liveness cannot be confirmed either way',
    heartbeatAgeSec: null,
    pidAlive: null,
    sameHost: null,
  }
}

// The one place that decides "is this deploy/CI record actually running."
// See the module doc comment above for why this must stay the sole
// implementation of the rule.
export function classifyRunState(
  record: DeployStatusRecord | null | undefined,
  opts: ClassifyRunStateOptions = {},
): RunStateResult {
  const now = opts.now ?? Date.now()
  const currentHost = opts.currentHost ?? hostname()
  const isPidAlive = opts.isPidAlive ?? defaultIsPidAlive

  if (!record || typeof record !== 'object') {
    return { state: 'unknown', reason: 'no record', heartbeatAgeSec: null, pidAlive: null, sameHost: null }
  }

  if (!IN_FLIGHT_STATUSES.has(record.status ?? '')) {
    return {
      state: 'idle',
      reason: `status '${record.status ?? '(missing)'}' is terminal`,
      heartbeatAgeSec: null,
      pidAlive: null,
      sameHost: null,
    }
  }

  const writer = record.writer
  if (!writer || typeof writer.heartbeatAt !== 'string') {
    return classifyByAgeOnly(record, now)
  }

  const heartbeatAgeSec = ageSec(writer.heartbeatAt, now)
  const sameHost = typeof writer.host === 'string' && writer.host === currentHost

  if (sameHost && typeof writer.pid === 'number') {
    const pidAlive = isPidAlive(writer.pid)
    return pidAlive
      ? { state: 'running', reason: 'same-host writer pid is alive', heartbeatAgeSec, pidAlive: true, sameHost: true }
      : { state: 'orphaned', reason: 'same-host writer pid is no longer running', heartbeatAgeSec, pidAlive: false, sameHost: true }
  }

  // Cross-host (or same-host without a usable pid): the heartbeat is the
  // only signal available.
  if (heartbeatAgeSec === null) {
    return { state: 'unknown', reason: 'writer heartbeatAt is unparseable', heartbeatAgeSec: null, pidAlive: null, sameHost }
  }
  if (heartbeatAgeSec > ORPHAN_HEARTBEAT_THRESHOLD_SEC) {
    return {
      state: 'orphaned',
      reason: `heartbeat is ${heartbeatAgeSec}s old, past the ${ORPHAN_HEARTBEAT_THRESHOLD_SEC}s threshold`,
      heartbeatAgeSec,
      pidAlive: null,
      sameHost,
    }
  }
  return { state: 'running', reason: 'heartbeat is fresh', heartbeatAgeSec, pidAlive: null, sameHost }
}
