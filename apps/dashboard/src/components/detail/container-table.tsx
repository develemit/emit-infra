'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import type { Container, MetricPoint } from '@/lib/api'
import { restartContainer } from '@/lib/api'
import { useContainerRestarts } from '@/lib/use-container-restarts'

function RestartSparkline({ points }: { points: { t: number; restarts: number }[] }) {
  if (points.length < 2) return null
  const maxR = Math.max(...points.map(p => p.restarts))
  if (maxR === 0) return null

  const W = 60, H = 16
  const pts = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W
    const y = H - (p.restarts / maxR) * (H - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const oneHourAgo = Date.now() / 1000 - 3600
  const recent = points.filter(p => p.t >= oneHourAgo)
  const increased = recent.length >= 2 && recent[recent.length - 1].restarts > recent[0].restarts
  const color = increased ? 'var(--err)' : 'var(--fg-muted)'

  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function stateBadge(state: string): BadgeVariant {
  const s = state.toLowerCase()
  if (s === 'running') return 'ok'
  if (s === 'exited') return 'err'
  return 'warn'
}

function stateOrder(state: string): number {
  const s = state.toLowerCase()
  if (s === 'running') return 0
  if (s === 'restarting') return 1
  return 2
}

function sortContainers(containers: Container[]): Container[] {
  return [...containers].sort((a, b) => stateOrder(a.state) - stateOrder(b.state))
}

function buildLabel(c: Container): string {
  if (c.buildNumber) return `#${c.buildNumber}`
  const tag = c.image.split(':').at(-1) ?? ''
  return tag.slice(0, 8)
}

function MContainer({
  c,
  logsHref,
  projectName,
  onRefetch,
  metrics,
}: {
  c: Container
  logsHref: string
  projectName: string
  onRefetch?: () => void
  metrics?: ContainerMetrics
}) {
  const [restarting, setRestarting] = useState(false)
  const variant = stateBadge(c.state)

  async function handleRestart() {
    setRestarting(true)
    try {
      await restartContainer(projectName, c.name)
      onRefetch?.()
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div
      className="rounded-xl border border-border bg-card flex flex-col gap-1.5"
      style={{ padding: 12 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-[13px] text-fg">{c.name}</span>
        <div className="flex items-center gap-2">
          <Badge variant={variant} dot>{c.state}</Badge>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="text-subtle hover:text-fg transition-colors disabled:opacity-40"
            title="Restart container"
          >
            <Icon name="refresh" size={13} />
          </button>
          <Link href={logsHref} className="text-subtle hover:text-fg transition-colors">
            <Icon name="file" size={13} />
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="font-mono text-[11px] text-subtle truncate flex-1">{c.image}</div>
        <span className="font-mono text-[11px] text-faint shrink-0">{buildLabel(c)}</span>
      </div>
      <div className="font-mono text-[11px] text-faint">{c.status}</div>
      {metrics && (
        <div className="flex items-center gap-3 text-[11px] font-mono text-subtle mt-0.5">
          <span>CPU {metrics.cpu.toFixed(1)}%</span>
          <span>{metrics.memMb.toFixed(0)} MB</span>
          {metrics.restarts > 0 && (
            <span style={{ color: 'var(--err)' }}>{metrics.restarts} restarts</span>
          )}
        </div>
      )}
    </div>
  )
}

interface ContainerMetrics {
  cpu: number
  memMb: number
  restarts: number
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
  const cMetrics = metricsMap(latestMetric)
  const restartSeries = useContainerRestarts(projectName)
  const sorted = latestMetric ? sortByMemory(containers, cMetrics) : sortContainers(containers)
  const runningCount = containers.filter(c => c.state.toLowerCase() === 'running').length
  const logsBase = `/projects/${encodeURIComponent(projectName)}/logs`

  async function handleRestart(containerName: string) {
    setRestartingSet(prev => new Set(prev).add(containerName))
    try {
      await restartContainer(projectName, containerName)
      onRefetch?.()
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
                    <tr
                      key={c.name}
                      className="border-t border-border hover:bg-card-hover transition-colors"
                    >
                      <td className="font-mono font-medium text-[12px] text-fg py-3 pr-3">{c.name}</td>
                      <td
                        className="font-mono text-[12px] text-subtle py-3 pr-3 truncate"
                        style={{ maxWidth: 200 }}
                      >
                        {c.image}
                      </td>
                      <td className="font-mono text-[12px] text-faint py-3 pr-3 whitespace-nowrap">
                        {buildLabel(c)}
                      </td>
                      <td className="font-mono text-[12px] text-subtle py-3 pr-3 whitespace-nowrap">
                        {cm ? `${cm.cpu.toFixed(1)}%` : '—'}
                      </td>
                      <td className="font-mono text-[12px] text-subtle py-3 pr-3 whitespace-nowrap">
                        {cm ? `${cm.memMb.toFixed(0)} MB` : '—'}
                      </td>
                      <td className="font-mono text-[12px] py-3 pr-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span style={{ color: cm && cm.restarts > 0 ? 'var(--err)' : 'var(--subtle)' }}>
                            {cm ? cm.restarts : '—'}
                          </span>
                          {restartSeries[c.name] && (
                            <RestartSparkline points={restartSeries[c.name]} />
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge variant={stateBadge(c.state)} dot>{c.state}</Badge>
                      </td>
                      <td className="font-mono text-[12px] text-subtle py-3 pr-3">{c.status}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRestart(c.name)}
                            disabled={isRestarting}
                            className="text-subtle hover:text-fg transition-colors disabled:opacity-40"
                            title="Restart container"
                          >
                            <Icon name="refresh" size={13} />
                          </button>
                          <Link href={href} className="text-subtle hover:text-fg transition-colors">
                            <Icon name="file" size={13} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden flex flex-col gap-2">
            {sorted.map(c => (
              <MContainer
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
