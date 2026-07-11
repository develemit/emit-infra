export function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function getSslDaysLeft(sslExpiry: string | null | undefined): number | null {
  if (sslExpiry == null) return null
  return Math.round((new Date(sslExpiry).getTime() - Date.now()) / 86_400_000)
}
