'use client'
import { useState, useEffect } from 'react'
import { getMemoryTrend, type MemoryTrend } from './api'

export function useMemoryTrend(name: string): MemoryTrend | null {
  const [trend, setTrend] = useState<MemoryTrend | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      const result = await getMemoryTrend(name).catch((err) => {
        console.warn('memory-trend fetch failed:', err)
        return null
      })
      if (!cancelled) setTrend(result)
    }
    void fetch()
    const id = setInterval(() => void fetch(), 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name])

  return trend
}
