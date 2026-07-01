import type { ProjectConfig } from '@emit-infra/types'

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '/api'
const API_SECRET = process.env['NEXT_PUBLIC_API_SECRET']

export function getApiBase(): string {
  return API_BASE
}

function authHeaders(): Record<string, string> {
  if (!API_SECRET) return {}
  return { Authorization: `Bearer ${API_SECRET}` }
}

export type SseEvent =
  | { type: 'line'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

export type { ProjectConfig }

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
  error?: string
}

export interface DiskDir {
  path: string
  bytes: number
}

export interface Container {
  name: string
  image: string
  status: string
  state: string
  buildNumber?: string
}

async function apiFetch<T>(path: string): Promise<T> {
  const MAX_RETRIES = 2
  const delays = [300, 600]

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', headers: authHeaders() })
      if (!res.ok) {
        if (res.status >= 500) {
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, delays[attempt]))
            continue
          }
        }
        throw new Error(`API error ${res.status}: ${path}`)
      }
      return res.json() as Promise<T>
    } catch (err) {
      if (attempt < MAX_RETRIES && err instanceof TypeError) {
        await new Promise(r => setTimeout(r, delays[attempt]))
        continue
      }
      throw err
    }
  }

  throw new Error(`API error after retries: ${path}`)
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

export interface DockerUsageRow {
  type: string
  total: number
  active: number
  size: string
  reclaimable: string
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

export function syncSecrets(name: string): { url: string } {
  return { url: `${API_BASE}/projects/${encodeURIComponent(name)}/secrets-sync` }
}

// --- History types and fetch functions ---

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

export interface DeployHistoryEntry {
  status: string
  sha: string
  branch: string
  startedAt: string
  completedAt: string
  durationSec: number
  servicesBuilt: string[]
  message?: string
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

export function getMetrics(name: string, hours?: number): Promise<MetricsResponse> {
  const qs = hours ? `?hours=${hours}` : ''
  return apiFetch<MetricsResponse>(`/projects/${encodeURIComponent(name)}/metrics${qs}`)
}

export function getDeployHistory(name: string, limit?: number): Promise<DeployHistoryResponse> {
  const qs = limit ? `?limit=${limit}` : ''
  return apiFetch<DeployHistoryResponse>(`/projects/${encodeURIComponent(name)}/deploy-history${qs}`)
}

export function getCiHistory(name: string, limit?: number): Promise<CiHistoryResponse> {
  const qs = limit ? `?limit=${limit}` : ''
  return apiFetch<CiHistoryResponse>(`/projects/${encodeURIComponent(name)}/ci-history${qs}`)
}

export interface DiskTrend {
  disk: number
  pctPerDay: number
  projectedDaysUntilFull: number | null
}

export async function getDiskTrend(name: string): Promise<DiskTrend | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/disk-trend`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json() as Promise<DiskTrend>
}

export interface MemoryTrend {
  mem: number
  pctPerDay: number
  projectedDaysUntilFull: number | null
}

export async function getMemoryTrend(name: string): Promise<MemoryTrend | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/memory-trend`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json() as Promise<MemoryTrend>
}

export type ContainerRestartSeries = Record<string, { t: number; restarts: number }[]>

export async function getContainerRestarts(name: string, hours = 24): Promise<ContainerRestartSeries> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/container-restarts?hours=${hours}`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return {}
  return res.json() as Promise<ContainerRestartSeries>
}

export interface BackupStatus {
  lastRun: string
  status: 'ok' | 'failed'
}

export async function getBackupStatus(name: string): Promise<BackupStatus | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/backup-status`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json() as Promise<BackupStatus>
}

export async function getCiLog(name: string, sha: string): Promise<string> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/ci-log/${encodeURIComponent(sha)}`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return ''
  if (!res.ok) throw new Error(`getCiLog failed: ${res.status}`)
  return res.text()
}

export async function getDeployLog(name: string, sha: string): Promise<string> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/deploy-log/${encodeURIComponent(sha)}`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404) return ''
  if (!res.ok) throw new Error(`getDeployLog failed: ${res.status}`)
  return res.text()
}

export function openSseStream(path: string): EventSource {
  const base = `${API_BASE}${path}`
  if (!API_SECRET) return new EventSource(base)
  const sep = path.includes('?') ? '&' : '?'
  return new EventSource(`${base}${sep}token=${encodeURIComponent(API_SECRET)}`)
}

export interface BackupObject {
  key: string
  sizeBytes: number
  lastModified: string
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

export function provisionProject(
  name: string,
  config: Record<string, unknown>,
): { url: string; body: string } {
  return {
    url: `${API_BASE}/projects/${encodeURIComponent(name)}/provision`,
    body: JSON.stringify({ config }),
  }
}

export async function getDiskDirs(name: string): Promise<DiskDir[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/disk-dirs`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { dirs: DiskDir[] }
  return body.dirs
}

export interface PgTable {
  name: string
  totalBytes: number
  rowEstimate: number
}

export async function getPgTableSizes(name: string): Promise<PgTable[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/pg-table-sizes`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { tables: PgTable[] }
  return body.tables
}

export interface CronJob {
  schedule: string
  command: string
  user?: string
  source: string
}

export async function getCronJobs(name: string): Promise<CronJob[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/cron-jobs`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { jobs: CronJob[] }
  return body.jobs
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

export async function getUfwRules(name: string): Promise<UfwStatus> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/ufw-rules`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return { status: 'inactive', rules: [] }
  return res.json() as Promise<UfwStatus>
}

export type SecretsDrift =
  | { status: 'unconfigured' }
  | { status: 'ok' | 'drift'; missing: string[]; extra: string[]; present: string[] }

export async function getSecretsDrift(name: string): Promise<SecretsDrift | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/secrets-drift`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 503) return null
  if (!res.ok) return null
  return res.json() as Promise<SecretsDrift>
}

export type ResponseTimes =
  | { available: false }
  | { available: true; p50ms: number; p95ms: number; p99ms: number; sampleCount: number }

export async function getResponseTimes(name: string): Promise<ResponseTimes> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/response-times`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return { available: false }
  return res.json() as Promise<ResponseTimes>
}
