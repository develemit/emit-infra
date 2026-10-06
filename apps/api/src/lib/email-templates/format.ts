import { formatDuration } from '../http-health.js'

const DEFAULT_DASHBOARD_ORIGIN = 'http://localhost:7013'

export function dashboardUrl(path: string): string {
  const origin = process.env['DASHBOARD_ORIGIN'] ?? DEFAULT_DASHBOARD_ORIGIN
  try {
    return new URL(path, origin).toString()
  } catch {
    return path
  }
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Phoenix',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "Oct 6, 08:50 MST · 14m ago" — Phoenix has no DST, so the zone is always MST. */
export function formatTime(ms: number, nowMs: number): string {
  const parts = Object.fromEntries(clock.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const abs = `${parts['month']} ${parts['day']}, ${parts['hour']}:${parts['minute']} MST`
  const age = nowMs - ms
  return age < 60_000 ? `${abs} · just now` : `${abs} · ${formatDuration(age)} ago`
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
