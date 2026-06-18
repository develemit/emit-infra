'use client'
import { useEffect, useState } from 'react'
import { getDeployHistory, type DeployHistoryEntry } from '@/lib/api'

export function useDeployMarkers(name: string) {
  const [deploys, setDeploys] = useState<DeployHistoryEntry[]>([])

  useEffect(() => {
    let cancelled = false

    async function fetch() {
      try {
        const res = await getDeployHistory(name, 20)
        if (!cancelled) setDeploys(res.deploys)
      } catch {
        // ignore — deploys are supplementary
      }
    }

    void fetch()
    const id = setInterval(() => void fetch(), 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name])

  return { deploys }
}
