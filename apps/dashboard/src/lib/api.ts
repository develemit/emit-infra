const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '/api'

export function getApiBase(): string {
  return API_BASE
}

export type SseEvent =
  | { type: 'line'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

export interface ProjectConfig {
  name: string
  domain: string
  region: string
}

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
  error?: string
}

export interface Container {
  name: string
  image: string
  status: string
  state: string
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export function getProjects(): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>('/projects')
}

export async function getStatus(name: string): Promise<ProjectStatus> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/status`, { cache: 'no-store' })
  if (res.status === 503) return res.json() as Promise<ProjectStatus>
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json() as Promise<ProjectStatus>
}

export async function getContainers(name: string): Promise<Container[]> {
  const data = await apiFetch<Container[] | { error: string }>(
    `/projects/${encodeURIComponent(name)}/containers`,
  )
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
    headers: { 'Content-Type': 'application/json' },
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

export async function pruneDocker(name: string): Promise<{ ok: boolean; output: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/prune`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Prune failed: ${res.status}`)
  return res.json() as Promise<{ ok: boolean; output: string }>
}

export function openSseStream(path: string): EventSource {
  return new EventSource(`${API_BASE}${path}`)
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
