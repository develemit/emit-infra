import type { ProjectStatus, BackupStatus } from '@/lib/api'

export interface FleetRow {
  name: string
  status: ProjectStatus | null
  ciPassRate: number | null
  backup: BackupStatus | null
}

export function pctColor(pct: number | undefined): string {
  if (pct === undefined) return 'var(--fg-muted)'
  if (pct > 90) return 'var(--err)'
  if (pct > 75) return '#f59e0b'
  return 'var(--ok, #22c55e)'
}

export function ciColor(rate: number | null): string {
  if (rate === null) return 'var(--fg-muted)'
  if (rate >= 0.9) return 'var(--ok, #22c55e)'
  if (rate >= 0.7) return '#f59e0b'
  return 'var(--err)'
}

export function sslDays(expiry: string | null | undefined): number | null {
  if (!expiry) return null
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000)
}

export function sslColor(expiry: string | null | undefined): string {
  const days = sslDays(expiry)
  if (days === null) return 'var(--fg-muted)'
  if (days < 7) return 'var(--err)'
  if (days < 30) return '#f59e0b'
  return 'var(--ok, #22c55e)'
}

export function sslLabel(expiry: string | null | undefined): string {
  const days = sslDays(expiry)
  if (days === null) return '—'
  if (days < 0) return 'Expired'
  return `${days}d`
}

export function backupAgeHours(lastRun: string | undefined): number | null {
  if (!lastRun) return null
  return (Date.now() - new Date(lastRun).getTime()) / 3600000
}

export function backupColor(lastRun: string | undefined): string {
  const h = backupAgeHours(lastRun)
  if (h === null) return 'var(--fg-muted)'
  if (h > 49) return 'var(--err)'
  if (h > 25) return '#f59e0b'
  return 'var(--ok, #22c55e)'
}

export function backupLabel(lastRun: string | undefined, status: string | undefined): string {
  const h = backupAgeHours(lastRun)
  if (h === null) return '—'
  const age = h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`
  return status === 'failed' ? `${age} (failed)` : age
}

export function deployAge(deployedAt: string | null | undefined): string {
  if (!deployedAt) return '—'
  const h = (Date.now() - new Date(deployedAt).getTime()) / 3600000
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h >= 1) return `${Math.floor(h)}h ago`
  return 'just now'
}

export function rowLevel(r: FleetRow): 'fail' | 'warn' | 'ok' {
  const disk = r.status?.disk
  const mem = r.status?.memory
  const http = r.status?.httpStatus
  const bh = backupAgeHours(r.backup?.lastRun)
  const ssl = sslDays(r.status?.sslExpiry)
  if (disk !== undefined && disk > 90) return 'fail'
  if (mem !== undefined && mem > 90) return 'fail'
  if (http != null && (http < 200 || http >= 400)) return 'fail'
  if (r.ciPassRate !== null && r.ciPassRate < 0.7) return 'fail'
  if (bh !== null && bh > 49) return 'fail'
  if (r.backup?.status === 'failed') return 'fail'
  if (disk !== undefined && disk > 75) return 'warn'
  if (mem !== undefined && mem > 75) return 'warn'
  if (http != null && http >= 300) return 'warn'
  if (r.ciPassRate !== null && r.ciPassRate < 0.9) return 'warn'
  if (bh !== null && bh > 25) return 'warn'
  if (ssl !== null && ssl < 30) return 'warn'
  return 'ok'
}

export function httpColor(code: number | null | undefined): string {
  if (code == null) return 'var(--fg-muted)'
  if (code >= 200 && code < 300) return 'var(--ok, #22c55e)'
  if (code >= 300 && code < 400) return '#f59e0b'
  return 'var(--err)'
}
