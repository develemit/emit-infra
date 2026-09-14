/**
 * Debounced up/down state machine for the status monitor's HTTP and SSH
 * probes. Pure logic — no I/O — so restart-seeding and reminder timing can
 * be unit tested without a live server or clock mocking beyond `nowMs`.
 *
 * Used for both probes: HTTP results carry a `status` code (for cause text),
 * SSH results don't.
 */

export const DOWN_THRESHOLD = 3
export const UP_THRESHOLD = 3
export const FIRST_REMINDER_MS = 60 * 60 * 1000
export const REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface ProbeResult {
  ok: boolean
  status?: number
}

export type HealthStatus = 'up' | 'down' | 'unknown'

export interface HealthState {
  status: HealthStatus
  consecutiveFails: number
  consecutiveOks: number
  downSinceMs: number | undefined
  lastReminderMs: number | undefined
  lastStatus: number | undefined
}

export type HealthEvent =
  | { kind: 'down'; status: number | undefined }
  | { kind: 'up'; downDurationMs: number }
  | { kind: 'reminder'; status: number | undefined; downDurationMs: number }

export const initialHealthState: HealthState = {
  status: 'unknown',
  consecutiveFails: 0,
  consecutiveOks: 0,
  downSinceMs: undefined,
  lastReminderMs: undefined,
  lastStatus: undefined,
}

/** Cloudflare edge status codes worth naming in notifications instead of a
 *  bare status number — 526 is the one that actually bit diner-decider. */
const STATUS_CAUSES: Record<number, string> = {
  526: 'origin TLS certificate invalid or expired',
  525: 'TLS handshake with origin failed',
  522: 'origin connection timed out',
  521: 'origin refused the connection',
  502: 'bad gateway',
  504: 'gateway timeout',
}

export function causeText(status?: number): string {
  if (status === undefined) return 'no response from the health check'
  return STATUS_CAUSES[status] ?? `HTTP ${status} from origin`
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function reminderDue(state: HealthState, nowMs: number): boolean {
  const downSinceMs = state.downSinceMs ?? nowMs
  if (state.lastReminderMs === undefined) {
    return nowMs - downSinceMs >= FIRST_REMINDER_MS
  }
  return nowMs - state.lastReminderMs >= REMINDER_INTERVAL_MS
}

/** Advance the state machine by one poll result. Requires `DOWN_THRESHOLD`
 *  consecutive failures before declaring down (and `UP_THRESHOLD` consecutive
 *  successes before declaring recovered), so a probe that flaps for one or
 *  two polls never fires a notification — only a genuine, sustained outage
 *  does. While down, emits a `reminder` event once an hour has passed, then
 *  every six hours, so the site being down for a day still isn't silent. */
export function stepHealth(
  state: HealthState,
  result: ProbeResult,
  nowMs: number,
): { state: HealthState; events: HealthEvent[] } {
  const lastStatus = result.status ?? state.lastStatus

  if (result.ok) {
    const consecutiveOks = state.consecutiveOks + 1

    if (state.status === 'down' && consecutiveOks >= UP_THRESHOLD) {
      const downDurationMs = nowMs - (state.downSinceMs ?? nowMs)
      return {
        state: {
          status: 'up', consecutiveFails: 0, consecutiveOks,
          downSinceMs: undefined, lastReminderMs: undefined, lastStatus,
        },
        events: [{ kind: 'up', downDurationMs }],
      }
    }

    return {
      state: {
        ...state, status: state.status === 'down' ? 'down' : 'up',
        consecutiveFails: 0, consecutiveOks, lastStatus,
      },
      events: [],
    }
  }

  const consecutiveFails = state.consecutiveFails + 1

  if (state.status !== 'down' && consecutiveFails >= DOWN_THRESHOLD) {
    return {
      state: {
        status: 'down', consecutiveFails, consecutiveOks: 0,
        downSinceMs: nowMs, lastReminderMs: undefined, lastStatus,
      },
      events: [{ kind: 'down', status: lastStatus }],
    }
  }

  if (state.status === 'down' && reminderDue(state, nowMs)) {
    const downDurationMs = nowMs - (state.downSinceMs ?? nowMs)
    return {
      state: { ...state, consecutiveFails, consecutiveOks: 0, lastReminderMs: nowMs, lastStatus },
      events: [{ kind: 'reminder', status: lastStatus, downDurationMs }],
    }
  }

  return { state: { ...state, consecutiveFails, consecutiveOks: 0, lastStatus }, events: [] }
}

/** Seed state from the last `.incidents.jsonl` event so a monitor restart
 *  mid-outage still sends reminders and a recovery notification instead of
 *  forgetting the outage was ever happening. */
export function seedHealthState(
  lastEvent: { event: 'up' | 'down'; t: number } | undefined,
  _nowMs: number,
): HealthState {
  if (!lastEvent) return initialHealthState
  if (lastEvent.event === 'up') {
    return {
      status: 'up', consecutiveFails: 0, consecutiveOks: UP_THRESHOLD,
      downSinceMs: undefined, lastReminderMs: undefined, lastStatus: undefined,
    }
  }
  return {
    status: 'down', consecutiveFails: DOWN_THRESHOLD, consecutiveOks: 0,
    downSinceMs: lastEvent.t * 1000, lastReminderMs: undefined, lastStatus: undefined,
  }
}
