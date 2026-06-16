'use client'
import { useEffect, useState } from 'react'
import { computeUptimePct, type MetricPoint } from '@/lib/metric-history'

export function useUptimePct(name: string): number | null {
  const [uptimePct, setUptimePct] = useState<number | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`emit-infra:metrics:${name}`)
      if (!raw) return
      const pts: (MetricPoint & { up?: boolean })[] = JSON.parse(raw)
      const history = pts.map(p => ({ ...p, up: p.up ?? true }))
      setUptimePct(computeUptimePct(history))
    } catch { /* corrupt storage */ }
  }, [name])

  return uptimePct
}
