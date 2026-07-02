'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  getStatus, getContainers, getProjects, getApiBase,
  type ProjectSummary, type ProjectStatus, type Container,
} from '@/lib/api'
import { deriveHealth } from '@/lib/health'
import { useMetricHistory, computeUptimePct } from '@/lib/metric-history'
import { useServerMetrics } from '@/lib/use-server-metrics'
import { useDeployMarkers } from '@/lib/use-deploy-markers'
import { useDiskTrend } from '@/lib/use-disk-trend'
import { useMemoryTrend } from '@/lib/use-memory-trend'
import { useBackupStatus } from '@/lib/use-backup-status'
import type { DeployMarker } from '@/components/detail/resource-chart'

export function useProjectDetail(name: string) {
  const apiBase = getApiBase()

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [status, setStatus] = useState<ProjectStatus | null>(null)
  const [containers, setContainers] = useState<Container[] | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [showRollback, setShowRollback] = useState(false)
  const [showSecretsSync, setShowSecretsSync] = useState(false)
  const [showDestroy, setShowDestroy] = useState(false)
  const [lastPolledAt, setLastPolledAt] = useState<number>(0)
  const [polledAgo, setPolledAgo] = useState('')
  const [rangeHours, setRangeHours] = useState(24)

  const fetchData = useCallback(async () => {
    await Promise.all([
      getProjects().then(ps => setProject(ps.find(p => p.config.name === name) ?? null)),
      getStatus(name).then(s => setStatus(s)),
      getContainers(name).then(c => setContainers(c)),
    ])
    setLastPolledAt(Date.now())
  }, [name])

  useEffect(() => {
    const BASE_MS = 30_000
    const MAX_MS = 120_000
    let currentMs = BASE_MS
    let timeoutId: ReturnType<typeof setTimeout>

    const schedule = () => {
      const jitter = Math.random() * 10_000 - 5_000
      timeoutId = setTimeout(async () => {
        try {
          await fetchData()
          currentMs = BASE_MS
        } catch {
          currentMs = Math.min(currentMs * 2, MAX_MS)
        }
        schedule()
      }, currentMs + jitter)
    }

    void fetchData()
    schedule()
    return () => clearTimeout(timeoutId)
  }, [fetchData])

  useEffect(() => {
    const tick = setInterval(() => {
      if (lastPolledAt === 0) { setPolledAgo(''); return }
      const elapsed = Date.now() - lastPolledAt
      const seconds = Math.floor(elapsed / 1000)
      if (seconds <= 3) setPolledAgo('just now')
      else if (seconds < 60) setPolledAgo(`${seconds}s ago`)
      else setPolledAgo(`${Math.floor(seconds / 60)}m ago`)
    }, 1000)
    return () => clearInterval(tick)
  }, [lastPolledAt])

  const { variant, label } = deriveHealth(status, project?.config.warnThresholds)
  const domain = project?.config.domain ?? ''
  const loading = status === null
  const up = !!status && !status.error && status.httpStatus === 200
  const mem = status?.memory ?? null
  const disk = status?.disk ?? null

  const localHistory = useMetricHistory(name, mem, disk, up)
  const uptimePct = computeUptimePct(localHistory)
  const { points: serverPoints } = useServerMetrics(name, rangeHours)
  const { deploys } = useDeployMarkers(name)
  const diskTrend = useDiskTrend(name)
  const memoryTrend = useMemoryTrend(name)
  const backupStatus = useBackupStatus(name)

  const chartHistory = serverPoints.length >= 2
    ? serverPoints.map(p => ({ t: p.t * 1000, cpu: p.cpu, mem: p.mem, disk: p.disk }))
    : localHistory.map(p => ({ t: p.t, mem: p.mem, disk: p.disk }))
  const fullChartPoints = serverPoints.length >= 2
    ? serverPoints.map(p => ({ t: p.t * 1000, cpu: p.cpu, mem: p.mem, disk: p.disk }))
    : []
  const latestMetric = serverPoints.length > 0 ? serverPoints[serverPoints.length - 1] ?? null : null
  const deployMarkers: DeployMarker[] = deploys.map(d => ({
    completedAt: d.completedAt,
    sha: d.sha,
    status: d.status,
  }))
  const deployUrl = `${apiBase}/projects/${encodeURIComponent(name)}/deploy`

  return {
    project, status, containers,
    deploying, setDeploying,
    showRollback, setShowRollback,
    showSecretsSync, setShowSecretsSync,
    showDestroy, setShowDestroy,
    rangeHours, setRangeHours,
    polledAgo, loading, domain,
    variant, label,
    chartHistory, fullChartPoints, serverPoints,
    latestMetric, deployMarkers,
    deploys,
    diskTrend, memoryTrend, backupStatus,
    uptimePct, fetchData, deployUrl,
  }
}
