'use client'
import { useState, useEffect } from 'react'
import { getCiStatus, getDeployStatus, type CiStatus, type DeployStatus, type RunState } from './api-containers'

export interface PipelineStatus {
  ci: CiStatus | null
  deploy: DeployStatus | null
}

// The single fetch/poll implementation for CI + deploy status — sprint 285
// consolidates what used to be three separate copies (pipeline-progress-card,
// project-card, use-pipeline-running-count) so the running/orphaned/unknown
// classification is threaded through consistently everywhere it's read.
export function usePipelineStatus(name: string, intervalMs = 15_000): PipelineStatus {
  const [ci, setCi] = useState<CiStatus | null>(null)
  const [deploy, setDeploy] = useState<DeployStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      const [c, d] = await Promise.all([getCiStatus(name), getDeployStatus(name)])
      if (!cancelled) { setCi(c); setDeploy(d) }
    }
    void poll()
    const id = setInterval(() => void poll(), intervalMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [name, intervalMs])

  return { ci, deploy }
}

// A missing record (no file, or a pre-284 API build that hasn't been
// redeployed yet) has no classification to report. Treat that as 'idle'
// (nothing to show) rather than guessing whether it's running.
export function runStateOf(status: CiStatus | DeployStatus | null): RunState {
  if (!status) return 'idle'
  return status.runState?.state ?? 'unknown'
}
