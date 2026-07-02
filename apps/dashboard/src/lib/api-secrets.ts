import { authHeaders, getApiBase } from './api-auth.js'

const API_BASE = getApiBase()

export type SecretsDrift =
  | { status: 'unconfigured' }
  | { status: 'ok' | 'drift'; missing: string[]; extra: string[]; present: string[] }

export function syncSecrets(name: string): { url: string } {
  return { url: `${API_BASE}/projects/${encodeURIComponent(name)}/secrets-sync` }
}

export async function applySecrets(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/secrets-apply`, {
      method: 'POST',
      headers: authHeaders(),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return res.json() as Promise<{ ok: boolean; error?: string }>
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export async function getSecretsDrift(name: string): Promise<SecretsDrift | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/secrets-drift`, { cache: 'no-store', headers: authHeaders() })
  if (res.status === 503) return null
  if (!res.ok) return null
  return res.json() as Promise<SecretsDrift>
}
