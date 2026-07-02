import { authHeaders, getApiBase } from './api-auth.js'

const API_BASE = getApiBase()

export interface BackupStatus {
  lastRun: string
  status: 'ok' | 'failed'
}

export interface BackupObject {
  key: string
  sizeBytes: number
  lastModified: string
}

export interface CronJob {
  schedule: string
  command: string
  user?: string
  source: string
}

export interface UfwRule {
  num: number
  to: string
  action: string
  from: string
}

export interface UfwStatus {
  status: 'active' | 'inactive'
  rules: UfwRule[]
}

export async function getBackupStatus(name: string): Promise<BackupStatus | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/backup-status`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json() as Promise<BackupStatus>
}

export async function listBackups(name: string): Promise<BackupObject[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/backups`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { backups: BackupObject[] }
  return body.backups
}

export async function deleteBackup(name: string, key: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/backups/${encodeURIComponent(key)}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) return { ok: false }
  return res.json() as Promise<{ ok: boolean }>
}

export async function triggerBackup(name: string): Promise<{ ok: boolean; output: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/backups/trigger`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) return { ok: false, output: `HTTP ${res.status}` }
  return res.json() as Promise<{ ok: boolean; output: string }>
}

export async function getBackupDownloadUrl(name: string, key: string): Promise<string> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/backups/${encodeURIComponent(key)}/download`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) throw new Error(`download URL failed: ${res.status}`)
  const body = await res.json() as { url: string }
  return body.url
}

export async function updateBackupRetainDays(name: string, days: number): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ postgres: { backupRetainDays: days } }),
  })
  if (!res.ok) {
    const body = await res.json() as { error?: string }
    throw new Error(body.error ?? 'Failed to update')
  }
}

export async function getCronJobs(name: string): Promise<CronJob[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/cron-jobs`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { jobs: CronJob[] }
  return body.jobs
}

export async function getUfwRules(name: string): Promise<UfwStatus> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/ufw-rules`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return { status: 'inactive', rules: [] }
  return res.json() as Promise<UfwStatus>
}
