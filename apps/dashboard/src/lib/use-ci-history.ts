'use client'
import { useEffect, useState } from 'react'
import { getCiHistory, type CiHistoryEntry } from '@/lib/api'

export function useCiHistory(name: string) {
  const [runs, setRuns] = useState<CiHistoryEntry[]>([])

  useEffect(() => {
    let cancelled = false

    async function fetch() {
      try {
        const res = await getCiHistory(name, 50)
        if (!cancelled) setRuns(res.runs)
      } catch {
        // ignore — CI history is supplementary
      }
    }

    void fetch()
    const id = setInterval(() => void fetch(), 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name])

  return { runs }
}
