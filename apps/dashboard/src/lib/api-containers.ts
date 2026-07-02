import { apiFetch, authHeaders, getApiBase } from './api-auth.js'

const API_BASE = getApiBase()

export interface Container {
  name: string
  image: string
  status: string
  state: string
  buildNumber?: string
}

export interface DockerUsageRow {
  type: string
  total: number
  active: number
  size: string
  reclaimable: string
}

export interface CiProgress {
  step: number
  total: number
  pct: number
  label: string
}

export interface CiStatus {
  status: string
  sha?: string
  branch?: string
  startedAt?: string
  completedAt?: string
  progress?: CiProgress | null
}

export type DeployStatus = CiStatus

export async function getContainers(name: string): Promise<Container[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/containers`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 503) return []
  if (!res.ok) throw new Error(`API error ${res.status}`)
  const data = await res.json() as Container[] | { error: string }
  return Array.isArray(data) ? data : []
}

export function getSshKeys(): Promise<string[]> {
  return apiFetch<string[]>('/projects/ssh-keys')
}

export function getDockerUsage(name: string): Promise<DockerUsageRow[]> {
  return apiFetch<DockerUsageRow[]>(`/projects/${encodeURIComponent(name)}/docker-usage`)
}

export async function restartContainer(
  name: string,
  container: string,
): Promise<{ ok: boolean; output: string }> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(name)}/containers/${encodeURIComponent(container)}/restart`,
    { method: 'POST', cache: 'no-store', headers: authHeaders() },
  )
  if (!res.ok) throw new Error(`Restart failed: ${res.status}`)
  return res.json() as Promise<{ ok: boolean; output: string }>
}

export async function getCiStatus(name: string): Promise<CiStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/ci-status`, { cache: 'no-store', headers: authHeaders() })
    if (!res.ok) return null
    return res.json() as Promise<CiStatus>
  } catch {
    return null
  }
}

export async function getDeployStatus(name: string): Promise<DeployStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/deploy-status`, { cache: 'no-store', headers: authHeaders() })
    if (!res.ok) return null
    return res.json() as Promise<DeployStatus>
  } catch {
    return null
  }
}

export async function pruneDocker(name: string): Promise<{ ok: boolean; output: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/prune`, {
    method: 'POST',
    cache: 'no-store',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Prune failed: ${res.status}`)
  return res.json() as Promise<{ ok: boolean; output: string }>
}
