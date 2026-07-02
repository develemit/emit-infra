import type { ProjectConfig } from './api-auth'
import { apiFetch, authHeaders, getApiBase } from './api-auth'

const API_BASE = getApiBase()

export interface ProjectSummary {
  config: ProjectConfig
  configPath: string
  projectDir: string
}

export interface ProjectStatus {
  uptime?: string
  disk?: number
  diskUsed?: string
  diskTotal?: string
  memory?: number
  memUsed?: string
  memTotal?: string
  containerCount?: number
  containerTotal?: number
  containerUnhealthy?: number
  httpStatus?: number | null
  serverType?: string
  region?: string
  ip?: string
  buildNumber?: string | null
  nginxStatus?: string | null
  nginxConfigured?: boolean
  sslExpiry?: string | null
  redisStatus?: string | null
  queueFailed?: number | null
  queueWait?: number | null
  deployedAt?: string | null
  activeSlot?: string | null
  error?: string
}

export interface ProjectConfigPatch {
  serverType?: string
  sshKeyName?: string
  region?: string
  domain?: string
  serverIp?: string
  postgres?: {
    version?: string
    backupBucket?: string
    backupRetainDays?: number
  }
  requiredEnvKeys?: string[]
  warnThresholds?: {
    diskPct?: number
    memPct?: number
    backupAgeHours?: number
  }
}

export function getProjects(): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>('/projects')
}

export async function getStatus(name: string): Promise<ProjectStatus> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/status`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 503) return res.json() as Promise<ProjectStatus>
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json() as Promise<ProjectStatus>
}

export function getUnregistered(): Promise<string[]> {
  return apiFetch<string[]>('/projects/unregistered')
}

export async function registerProject(
  name: string,
  config: { domain: string; github: { repo: string }; region?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ config }),
  })
  if (!res.ok) throw new Error(`Register failed: ${res.status}`)
}

export function provisionProject(
  name: string,
  config: Record<string, unknown>,
): { url: string; body: string } {
  return {
    url: `${API_BASE}/projects/${encodeURIComponent(name)}/provision`,
    body: JSON.stringify({ config }),
  }
}

export async function getRollbackSnapshots(name: string): Promise<string[]> {
  const data = await apiFetch<{ snapshots: string[] }>(
    `/projects/${encodeURIComponent(name)}/rollback/snapshots`,
  )
  return data.snapshots
}

export function rollbackProject(
  name: string,
  timestamp?: string,
): { url: string; body: string } {
  return {
    url: `${API_BASE}/projects/${encodeURIComponent(name)}/rollback`,
    body: JSON.stringify(timestamp ? { timestamp } : {}),
  }
}

export async function updateProjectConfig(name: string, patch: ProjectConfigPatch): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `PATCH failed: ${res.status}`)
  }
}
