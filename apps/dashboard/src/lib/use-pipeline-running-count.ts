'use client'
import { useState, useEffect } from 'react'
import { getCiStatus, getDeployStatus, type ProjectSummary } from './api'
import { runStateOf } from './use-pipeline-status'

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
      // Only records the classifier confirms are actually running count —
      // an orphaned or unknown record isn't "N deploys in progress."
      let ci = 0, deploy = 0
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (runStateOf(r.value[0]) === 'running') ci++
          if (runStateOf(r.value[1]) === 'running') deploy++
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
