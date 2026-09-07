/**
 * Decides whether an HTTP health-check failure is worth a new log line.
 *
 * checkHttp() in project-status.ts polls every 60s. A permanently unreachable
 * host doesn't fail with one consistent error — it races a 10s timeout
 * against a fast connection refusal, so consecutive polls alternate between a
 * `TimeoutError` (the abort signal won) and a `TypeError` (the socket refused
 * first) — measured live for the test-smoke fixture: 22 vs 19 of the two,
 * essentially every poll logged because each differed from the one before.
 * Keying dedup on the failure's *kind* rather than the full error string
 * collapses that race into one "unreachable" state, so a real outage produces
 * one failure line, not a drip.
 *
 * A heartbeat keeps a long outage from going silent forever: once per
 * `heartbeatMs` (default 1h) the still-failing state re-logs with a count of
 * how many polls were suppressed since the last line.
 */

export type Clock = () => number

interface DomainState {
  kind: string
  suppressed: number
  lastLoggedAt: number
}

export const DEFAULT_HTTP_CHECK_HEARTBEAT_MS = 60 * 60 * 1000

/** RFC 5737 documentation ranges (TEST-NET-1/2/3) — addresses guaranteed to
 *  never route anywhere real. Fixture projects (test-smoke) point their
 *  `domain` at one of these on purpose, to exercise the down-status path
 *  without a live host to probe. */
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const DOCUMENTATION_PREFIXES = ['192.0.2.', '198.51.100.', '203.0.113.']

export function isReservedTestDomain(domain: string): boolean {
  return IPV4_RE.test(domain) && DOCUMENTATION_PREFIXES.some((prefix) => domain.startsWith(prefix))
}

export function classifyFailureKind(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'unreachable'
    if (err instanceof TypeError) return 'unreachable'
    return err.name || 'unknown'
  }
  return 'unknown'
}

function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) {
    const hours = ms / 3_600_000
    return hours === 1 ? '1 hour' : `${hours} hours`
  }
  if (ms % 60_000 === 0) {
    const minutes = ms / 60_000
    return minutes === 1 ? '1 minute' : `${minutes} minutes`
  }
  const seconds = Math.round(ms / 1000)
  return seconds === 1 ? '1 second' : `${seconds} seconds`
}

export interface HttpCheckLog {
  /** Returns the message to log for this failure, or null to stay silent. */
  onFailure(domain: string, err: unknown, attempts: number, now?: number): string | null
  /** Returns true when there was a prior failure worth announcing recovery from. */
  onRecovery(domain: string): boolean
}

export function createHttpCheckLog(
  clock: Clock = Date.now,
  heartbeatMs = DEFAULT_HTTP_CHECK_HEARTBEAT_MS,
): HttpCheckLog {
  const state = new Map<string, DomainState>()

  return {
    onFailure(domain, err, attempts, now = clock()) {
      const kind = classifyFailureKind(err)
      const existing = state.get(domain)

      if (!existing || existing.kind !== kind) {
        state.set(domain, { kind, suppressed: 0, lastLoggedAt: now })
        return `HTTP check failed for ${domain} after ${attempts} attempts: ${String(err)}`
      }

      if (now - existing.lastLoggedAt < heartbeatMs) {
        existing.suppressed += 1
        return null
      }

      const occurrences = existing.suppressed
      existing.suppressed = 0
      existing.lastLoggedAt = now
      return `HTTP check still failing for ${domain} (${occurrences} occurrences in the last ${formatDuration(heartbeatMs)})`
    },

    onRecovery(domain) {
      return state.delete(domain)
    },
  }
}
