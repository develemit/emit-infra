import { authHeaders, getApiBase } from './api-auth.js'

const API_BASE = getApiBase()

export interface DiskDir {
  path: string
  bytes: number
}

export interface DiskCategory {
  path: string
  humanSize: string
}

export interface DiskBreakdown {
  categories: DiskCategory[]
}

export interface PgTable {
  name: string
  totalBytes: number
  rowEstimate: number
}

export interface NginxEndpoint {
  path: string
  requests: number
  errors: number
  errorRate: number
}

export interface NginxEndpointsData {
  available: boolean
  endpoints: NginxEndpoint[]
}

export interface ScaleAdvice {
  resource: 'disk' | 'memory'
  sustainedPct: number
  currentTier: string
  nextTier: string | null
  currentEurMonth: number | null
  nextEurMonth: number | null
  note?: 'disk'
}

export interface CertDetails {
  issuer: string
  subject: string
  serial: string
  notBefore: string
  notAfter: string
  sans: string[]
  renewTimerLastRan: string | null
  daysUntilExpiry: number
}

export interface ProjectCost {
  server: {
    eurPerMonth: number | null
    type: string
    region: string
  } | null
  storage: {
    usdPerMonth: number | null
    totalBytes: number
    bucketName: string
  } | null
}

export type ResponseTimes =
  | { available: false }
  | { available: true; p50ms: number; p95ms: number; p99ms: number; sampleCount: number }

export async function getDiskDirs(name: string): Promise<DiskDir[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/disk-dirs`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { dirs: DiskDir[] }
  return body.dirs
}

export async function getDiskBreakdown(name: string): Promise<DiskBreakdown> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/disk-breakdown`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return { categories: [] }
  return res.json() as Promise<DiskBreakdown>
}

export async function getPgTableSizes(name: string): Promise<PgTable[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/pg-table-sizes`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return []
  const body = await res.json() as { tables: PgTable[] }
  return body.tables
}

export async function getNginxEndpoints(name: string): Promise<NginxEndpointsData> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/nginx-endpoints`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return { available: false, endpoints: [] }
  return res.json() as Promise<NginxEndpointsData>
}

export async function getScaleAdvice(name: string): Promise<ScaleAdvice | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/scale-advice`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return null
  const body = await res.json() as { advice: ScaleAdvice | null }
  return body.advice
}

export async function getCertDetails(name: string): Promise<CertDetails | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/cert-details`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404 || res.status === 503) return null
  if (!res.ok) return null
  return res.json() as Promise<CertDetails>
}

export async function getProjectCost(name: string): Promise<ProjectCost | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/cost`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 404 || res.status === 503) return null
  if (!res.ok) return null
  return res.json() as Promise<ProjectCost>
}

export async function getResponseTimes(name: string): Promise<ResponseTimes> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/response-times`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) return { available: false }
  return res.json() as Promise<ResponseTimes>
}
