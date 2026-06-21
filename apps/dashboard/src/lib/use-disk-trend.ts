'use client'
import { useState, useEffect } from 'react'
import { getDiskTrend, type DiskTrend } from './api'

export function useDiskTrend(name: string): DiskTrend | null {
  const [trend, setTrend] = useState<DiskTrend | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      const result = await getDiskTrend(name).catch(() => null)
      if (!cancelled) setTrend(result)
    }
    void fetch()
    const id = setInterval(() => void fetch(), 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name])

  return trend
}
