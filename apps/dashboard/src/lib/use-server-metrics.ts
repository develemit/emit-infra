'use client'
import { useEffect, useState } from 'react'
import { getMetrics, type MetricPoint } from '@/lib/api'

export function useServerMetrics(name: string, hours = 24) {
  const [points, setPoints] = useState<MetricPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetch() {
      try {
        const res = await getMetrics(name, hours)
        if (!cancelled) {
          setPoints(res.points)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    void fetch()
    const id = setInterval(() => void fetch(), 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name, hours])

  return { points, loading }
}
