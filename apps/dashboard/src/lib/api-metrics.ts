import { apiFetch, authHeaders, getApiBase } from './api-auth.js'

const API_BASE = getApiBase()

export interface MetricPoint {
  t: number
  cpu: number
  mem: number
  memUsedMb: number
  memTotalMb: number
  disk: number
  diskUsedGb: string
  diskTotalGb: string
  netRxBytes: number
  netTxBytes: number
  nginx4xx?: number
  nginx5xx?: number
  queueFailed?: number | null
  queueWait?: number | null
  containers: { name: string; cpu: number; memMb: number; restarts: number }[]
}

export interface MetricsResponse {
  points: MetricPoint[]
  range: { from: number; to: number }
}

export type ContainerRestartSeries = Record<string, { t: number; restarts: number }[]>

export interface DiskTrend {
  disk: number
  pctPerDay: number
  projectedDaysUntilFull: number | null
}

export interface MemoryTrend {
  mem: number
  pctPerDay: number
  projectedDaysUntilFull: number | null
}

export interface DeployCadenceDay {
  date: string
  total: number
  failures: number
}

export interface SlaData {
  uptime7d: number
  uptime30d: number
}

export function getMetrics(name: string, hours?: number): Promise<MetricsResponse> {
  const qs = hours ? `?hours=${hours}` : ''
  return apiFetch<MetricsResponse>(`/projects/${encodeURIComponent(name)}/metrics${qs}`)
}

export async function getContainerRestarts(name: string, hours = 24): Promise<ContainerRestartSeries> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/container-restarts?hours=${hours}`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return {}
  return res.json() as Promise<ContainerRestartSeries>
}

export async function getDiskTrend(name: string): Promise<DiskTrend | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/disk-trend`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json() as Promise<DiskTrend>
}

export async function getMemoryTrend(name: string): Promise<MemoryTrend | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/memory-trend`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json() as Promise<MemoryTrend>
}

export async function getDeployCadence(name: string): Promise<DeployCadenceDay[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/deploy-cadence`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { days: DeployCadenceDay[] }
  return body.days
}

export async function getSla(name: string): Promise<SlaData | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/sla`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return null
  return res.json() as Promise<SlaData>
}
