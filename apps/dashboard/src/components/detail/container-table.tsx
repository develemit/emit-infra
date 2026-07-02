'use client'
import { useState } from 'react'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import type { Container, MetricPoint } from '@/lib/api'
import { restartContainer } from '@/lib/api'
import { useContainerRestarts } from '@/lib/use-container-restarts'
import { useToast } from '@/components/ui/toast'
import { MobileContainerRow, DesktopContainerRow, RestartSparkline, type ContainerMetrics } from './container-row'
import { ContainerLogViewer } from './container-log-viewer'

function stateOrder(state: string): number {
  const s = state.toLowerCase()
  if (s === 'running') return 0
  if (s === 'restarting') return 1
  return 2
}

function sortContainers(containers: Container[]): Container[] {
  return [...containers].sort((a, b) => stateOrder(a.state) - stateOrder(b.state))
}

interface ContainerTableProps {
  containers: Container[]
  projectName: string
  onRefetch?: () => void
  latestMetric?: MetricPoint | null
}

function metricsMap(metric?: MetricPoint | null): Map<string, ContainerMetrics> {
  const map = new Map<string, ContainerMetrics>()
  if (!metric?.containers) return map
  for (const c of metric.containers) {
    map.set(c.name, { cpu: c.cpu, memMb: c.memMb, restarts: c.restarts })
  }
  return map
}

function sortByMemory(containers: Container[], metrics: Map<string, ContainerMetrics>): Container[] {
  return [...containers].sort((a, b) => {
    const ma = metrics.get(a.name)?.memMb ?? 0
    const mb = metrics.get(b.name)?.memMb ?? 0
    if (mb !== ma) return mb - ma
    return stateOrder(a.state) - stateOrder(b.state)
  })
}

export function ContainerTable({ containers, projectName, onRefetch, latestMetric }: ContainerTableProps) {
  const [restartingSet, setRestartingSet] = useState<Set<string>>(new Set())
  const [activeLogsContainer, setActiveLogsContainer] = useState<string | null>(null)
  const [confirmRestart, setConfirmRestart] = useState<string | null>(null)
  const { showToast } = useToast()
  const cMetrics = metricsMap(latestMetric)
  const restartSeries = useContainerRestarts(projectName)
  const sorted = latestMetric ? sortByMemory(containers, cMetrics) : sortContainers(containers)
  const runningCount = containers.filter(c => c.state.toLowerCase() === 'running').length
  const logsBase = `/projects/${encodeURIComponent(projectName)}/logs`

  async function handleRestart(containerName: string) {
    setRestartingSet(prev => new Set(prev).add(containerName))
    try {
      await restartContainer(projectName, containerName)
      showToast(`Restarted ${containerName}`, 'success')
      onRefetch?.()
    } catch {
      showToast(`Failed to restart ${containerName}`, 'error')
    } finally {
      setRestartingSet(prev => {
        const next = new Set(prev)
        next.delete(containerName)
        return next
      })
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden" style={{ padding: 18 }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Icon name="box" size={16} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[13.5px] font-semibold text-fg">Containers</span>
        <Badge variant="muted" mono className="ml-1">{runningCount}/{containers.length} running</Badge>
      </div>

      {containers.length === 0 ? (
        <p className="text-sm text-subtle py-2">No containers found.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Name', 'Image', 'Build', 'CPU', 'Mem', 'Restarts', 'State', 'Status', ''].map(h => (
                    <th
                      key={h}
                      className="text-left text-[11px] font-semibold uppercase tracking-wide text-subtle pb-3"
                      style={{ paddingLeft: 0, paddingRight: 12 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const href = `${logsBase}?service=${encodeURIComponent(c.name)}`
                  const isRestarting = restartingSet.has(c.name)
                  const cm = cMetrics.get(c.name)
                  return (
                    <DesktopContainerRow
                      key={c.name}
                      c={c}
                      logsHref={href}
                      projectName={projectName}
                      isRestarting={isRestarting}
                      onRestart={confirmRestart === c.name ? async () => { await handleRestart(c.name); setConfirmRestart(null) } : async () => setConfirmRestart(c.name)}
                      isConfirming={confirmRestart === c.name}
                      onCancelRestart={() => setConfirmRestart(null)}
                      metrics={cm}
                      restartSeries={restartSeries[c.name]}
                      isLogsActive={activeLogsContainer === c.name}
                      onViewLogs={() => setActiveLogsContainer(activeLogsContainer === c.name ? null : c.name)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>

          {activeLogsContainer && (
            <ContainerLogViewer
              projectName={projectName}
              containerName={activeLogsContainer}
              onClose={() => setActiveLogsContainer(null)}
            />
          )}

          {/* Mobile cards */}
          <div className="lg:hidden flex flex-col gap-2">
            {sorted.map(c => (
              <MobileContainerRow
                key={c.name}
                c={c}
                logsHref={`${logsBase}?service=${encodeURIComponent(c.name)}`}
                projectName={projectName}
                onRefetch={onRefetch}
                metrics={cMetrics.get(c.name)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
