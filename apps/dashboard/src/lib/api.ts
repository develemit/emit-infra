const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'

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
  disk?: string
  memory?: string
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

export function getStatus(name: string): Promise<ProjectStatus> {
  return apiFetch<ProjectStatus>(`/projects/${encodeURIComponent(name)}/status`)
}

export async function getContainers(name: string): Promise<Container[]> {
  const data = await apiFetch<Container[] | { error: string }>(
    `/projects/${encodeURIComponent(name)}/containers`,
  )
  return Array.isArray(data) ? data : []
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
