const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Formats a `YYYY-MM` string without routing through Date. `new Date('2026-07-01')`
 * parses as UTC midnight, so rendering it in local time shows the *previous*
 * month for any timezone behind UTC — July data was labelled "June" in Phoenix.
 * Falls back to the raw string rather than inventing a month.
 */
export function formatBillingMonth(month: string): string {
  const [year, monthNum] = month.split('-')
  const name = MONTH_NAMES[Number(monthNum) - 1]
  if (!year || !name) return month
  return `${name} ${year}`
}

export interface SslDaysResult {
  value: string
  color?: string
  days: number
}

export function sslDaysLeft(expiry: string | null | undefined): SslDaysResult {
  if (!expiry) return { value: '—', days: Infinity }
  const expiryDate = new Date(expiry)
  if (isNaN(expiryDate.getTime())) return { value: '—', days: Infinity }
  const days = Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { value: 'Expired', color: 'var(--err)', days }
  if (days < 7) return { value: `${days}d`, color: 'var(--err)', days }
  if (days < 30) return { value: `${days}d`, color: 'var(--warn, #e5a00d)', days }
  return { value: `${days}d`, color: 'var(--ok, #22c55e)', days }
}

export function deployedAgo(epoch: string | null | undefined): string {
  if (!epoch) return '—'
  const secs = Math.floor(Date.now() / 1000) - parseInt(epoch, 10)
  if (isNaN(secs) || secs < 0) return '—'
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export function formatAgo(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffH < 1) return 'just now'
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d ago`
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatTimeLabel(ts: number, hours: number): string {
  const d = new Date(ts)
  if (hours <= 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function formatTooltipTime(ts: number): string {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
