'use client'
import { useState, useEffect } from 'react'
import { getCiStatus, getDeployStatus, type ProjectSummary } from './api'

export function usePipelineRunningCount(projects: ProjectSummary[] | null) {
  const [ciRunning, setCiRunning] = useState(0)
  const [deployRunning, setDeployRunning] = useState(0)

  useEffect(() => {
    if (!projects) return
    let cancelled = false
    async function poll() {
      const results = await Promise.allSettled(
        projects!.map(p => Promise.all([
          getCiStatus(p.config.name),
          getDeployStatus(p.config.name),
        ]))
      )
      if (cancelled) return
      let ci = 0, deploy = 0
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value[0]?.status === 'running') ci++
          if (r.value[1]?.status === 'deploying') deploy++
        }
      }
      setCiRunning(ci)
      setDeployRunning(deploy)
    }
    void poll()
    const id = setInterval(() => void poll(), 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [projects])

  return { ciRunning, deployRunning }
}
