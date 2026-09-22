import { apiFetch, authHeaders, getApiBase } from './api-auth'

const API_BASE = getApiBase()

// Sprint 290's launch stamp — how the deploy was started. Absent on
// pre-290 entries. Deploy-only; ci-history entries never carry it.
export interface DeployLaunchInfo {
  mode: 'detached' | 'interactive' | 'unattended-override'
  marker: string
}

export interface DeployHistoryEntry {
  status: string
  sha: string
  branch: string
  startedAt: string
  completedAt: string
  durationSec: number
  servicesBuilt: string[]
  /** Per-phase seconds (ci, auth, build, retag, preDeploy, deploy). Absent on pre-2026-08 entries. */
  phases?: Record<string, number>
  message?: string
  launch?: DeployLaunchInfo
}

export interface DeployHistoryResponse {
  deploys: DeployHistoryEntry[]
}

export interface CiHistoryEntry {
  status: string
  sha: string
  branch: string
  startedAt: string
  completedAt: string
  durationSec: number
  message?: string
}

export interface CiHistoryResponse {
  runs: CiHistoryEntry[]
}

// Sprint 310's serve-supervised.sh writes one of these per restart/stop.
export interface ServerDeathEntry {
  ts: string
  name: string
  reason: 'health-timeout' | 'exited' | 'signalled'
  exitCode: number | null
  signal: string | null
  uptimeSec: number
  restartCount: number
  pid: number | null
  host: string
  lastOutput: string
  /** Sprint 321's parent-chain snapshot, captured only for `reason: 'signalled'`. */
  signalContext?: string | null
}

export interface ServerDeathsResponse {
  deaths: ServerDeathEntry[]
}

export interface Incident {
  startedAt: number
  resolvedAt: number | null
  durationSec: number | null
  resolved: boolean
  note?: string
  falsePositive?: boolean
}

export interface IncidentsResponse {
  incidents: Incident[]
  mttrSec: number | null
}

export function getDeployHistory(name: string, limit?: number): Promise<DeployHistoryResponse> {
  const qs = limit ? `?limit=${limit}` : ''
  return apiFetch<DeployHistoryResponse>(`/projects/${encodeURIComponent(name)}/deploy-history${qs}`)
}

export function getCiHistory(name: string, limit?: number): Promise<CiHistoryResponse> {
  const qs = limit ? `?limit=${limit}` : ''
  return apiFetch<CiHistoryResponse>(`/projects/${encodeURIComponent(name)}/ci-history${qs}`)
}

export function getServerDeaths(name: string, limit?: number): Promise<ServerDeathsResponse> {
  const qs = limit ? `?limit=${limit}` : ''
  return apiFetch<ServerDeathsResponse>(`/projects/${encodeURIComponent(name)}/server-deaths${qs}`)
}

export interface LogResult {
  /** null means the log file doesn't exist — see predatesCapture for why. */
  content: string | null
  predatesCapture: boolean
}

async function fetchLog(url: string, label: string): Promise<LogResult> {
  const res = await fetch(url, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { predatesCapture?: boolean }
    return { content: null, predatesCapture: Boolean(body.predatesCapture) }
  }
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`)
  return { content: await res.text(), predatesCapture: false }
}

export function getCiLog(name: string, sha: string): Promise<LogResult> {
  return fetchLog(`${API_BASE}/projects/${encodeURIComponent(name)}/ci-log/${encodeURIComponent(sha)}`, 'getCiLog')
}

export function getDeployLog(name: string, sha: string): Promise<LogResult> {
  return fetchLog(`${API_BASE}/projects/${encodeURIComponent(name)}/deploy-log/${encodeURIComponent(sha)}`, 'getDeployLog')
}

export async function getIncidents(name: string): Promise<IncidentsResponse> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/incidents`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return { incidents: [], mttrSec: null }
  return res.json() as Promise<IncidentsResponse>
}

export async function annotateIncident(
  name: string,
  startedAt: number,
  patch: { note?: string; falsePositive?: boolean },
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(name)}/incidents/${encodeURIComponent(String(startedAt))}/annotation`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) throw new Error(`annotateIncident failed: ${res.status}`)
}

export interface FleetProjectData {
  project: string
  incidents: Incident[]
  deploys: Array<{ status: string; sha: string; completedAt: string }>
}

export async function getFleetIncidents(days: number = 7): Promise<FleetProjectData[]> {
  const res = await fetch(`${API_BASE}/fleet/incidents?days=${days}`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  return res.json() as Promise<FleetProjectData[]>
}

export async function exportIncidents(name: string, format: 'json' | 'csv', days: number = 90): Promise<void> {
  const qs = `?format=${encodeURIComponent(format)}&days=${encodeURIComponent(String(days))}`
  const url = `${API_BASE}/projects/${encodeURIComponent(name)}/incidents/export${qs}`
  window.open(url, '_blank')
}
