import type { ProjectConfig } from '@emit-infra/types'

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '/api'
const API_SECRET = process.env['NEXT_PUBLIC_API_SECRET']

export function getApiBase(): string {
  return API_BASE
}

export function authHeaders(): Record<string, string> {
  if (!API_SECRET) return {}
  return { Authorization: `Bearer ${API_SECRET}` }
}

export type SseEvent =
  | { type: 'line'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

export type { ProjectConfig }

export function openSseStream(path: string): EventSource {
  const base = `${API_BASE}${path}`
  if (!API_SECRET) return new EventSource(base)
  const sep = path.includes('?') ? '&' : '?'
  return new EventSource(`${base}${sep}token=${encodeURIComponent(API_SECRET)}`)
}

export async function apiFetch<T>(path: string): Promise<T> {
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
