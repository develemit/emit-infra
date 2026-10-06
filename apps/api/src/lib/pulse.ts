const PULSE_BASE = 'https://api.emitvision.com/v1/pulse'
const TIMEOUT_MS = 5_000

let warnedMissingEnv = false

export interface PulseOptions {
  fail?: boolean
  release?: string
}

export function warnIfPulseUnconfigured(): void {
  if (process.env.EMIT_VISION_INGEST_KEY || warnedMissingEnv) return
  warnedMissingEnv = true
  console.warn('[pulse] EMIT_VISION_INGEST_KEY not set — heartbeat pings disabled')
}

export function pulseUrl(slug: string, opts: PulseOptions = {}): string {
  const base = `${PULSE_BASE}/${slug}${opts.fail ? '/fail' : ''}`
  return opts.release ? `${base}?release=${encodeURIComponent(opts.release)}` : base
}

/** Best-effort emit-vision pulse ping. Never throws. */
export async function pingPulse(slug: string, opts: PulseOptions = {}): Promise<boolean> {
  const key = process.env.EMIT_VISION_INGEST_KEY
  if (!key) return false
  try {
    const res = await fetch(pulseUrl(slug, opts), {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}
