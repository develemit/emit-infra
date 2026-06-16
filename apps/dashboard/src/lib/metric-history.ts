import { useEffect, useState } from 'react'

export interface MetricPoint {
  t: number    // Unix ms
  mem: number  // 0–100
  disk: number // 0–100
  up: boolean  // was the project reachable at this poll?
}

const MAX_POINTS = 288         // 24h at 30s intervals
const TTL_MS = 24 * 60 * 60 * 1000

function storageKey(name: string) {
  return `emit-infra:metrics:${name}`
}

/**
 * Persists memory + disk readings in localStorage (24h window).
 * Each new reading from the 30s poll is appended; duplicate calls within
 * 20s are deduplicated so React StrictMode double-invocations don't corrupt
 * the series.
 */
export function useMetricHistory(
  name: string,
  mem: number | null,
  disk: number | null,
  up: boolean = true,
): MetricPoint[] {
  const [history, setHistory] = useState<MetricPoint[]>([])

  // Hydrate from localStorage on mount (client only — runs after hydration).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(name))
      if (!raw) return
      const now = Date.now()
      const pts: (MetricPoint & { up?: boolean })[] = JSON.parse(raw)
      setHistory(
        pts
          .filter(p => now - p.t < TTL_MS)
          .slice(-MAX_POINTS)
          .map(p => ({ ...p, up: p.up ?? true }))
      )
    } catch { /* corrupt storage — start fresh */ }
  }, [name])

  // Append a new reading whenever the polled status updates.
  useEffect(() => {
    if (mem === null) return
    const now = Date.now()
    setHistory(prev => {
      const last = prev[prev.length - 1]
      if (last && now - last.t < 20_000) return prev  // debounce
      const next = [...prev, { t: now, mem, disk: disk ?? 0, up }]
        .filter(p => now - p.t < TTL_MS)
        .slice(-MAX_POINTS)
      try {
        localStorage.setItem(storageKey(name), JSON.stringify(next))
      } catch { /* storage quota exceeded */ }
      return next
    })
  }, [name, mem, disk, up])

  return history
}

export function computeUptimePct(history: MetricPoint[]): number | null {
  if (history.length < 2) return null
  const upCount = history.filter(p => p.up).length
  return Math.round((upCount / history.length) * 100)
}
