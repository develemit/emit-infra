'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import type { Container } from '@/lib/api'
import { restartContainer } from '@/lib/api'
import { useToast } from '@/components/ui/toast'

interface ContainerMetrics {
  cpu: number
  memMb: number
  restarts: number
}

function stateBadge(state: string): BadgeVariant {
  const s = state.toLowerCase()
  if (s === 'running') return 'ok'
  if (s === 'exited') return 'err'
  return 'warn'
}

export function RestartSparkline({ points }: { points: { t: number; restarts: number }[] }) {
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

function buildLabel(c: Container): string {
  if (c.buildNumber) return `#${c.buildNumber}`
  const tag = c.image.split(':').at(-1) ?? ''
  return tag.slice(0, 8)
}

export function MobileContainerRow({
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
  const { showToast } = useToast()

  async function handleRestart() {
    setRestarting(true)
    try {
      await restartContainer(projectName, c.name)
      showToast(`Restarted ${c.name}`, 'success')
      onRefetch?.()
    } catch {
      showToast(`Failed to restart ${c.name}`, 'error')
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

export function DesktopContainerRow({
  c,
  logsHref,
  projectName,
  isRestarting,
  onRestart,
  isConfirming,
  onCancelRestart,
  metrics,
  restartSeries,
  isLogsActive,
  onViewLogs,
}: {
  c: Container
  logsHref: string
  projectName: string
  isRestarting: boolean
  onRestart: () => Promise<void>
  isConfirming?: boolean
  onCancelRestart?: () => void
  metrics?: ContainerMetrics
  restartSeries?: { t: number; restarts: number }[]
  isLogsActive?: boolean
  onViewLogs?: () => void
}) {
  return (
    <tr
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
        {metrics ? `${metrics.cpu.toFixed(1)}%` : '—'}
      </td>
      <td className="font-mono text-[12px] text-subtle py-3 pr-3 whitespace-nowrap">
        {metrics ? `${metrics.memMb.toFixed(0)} MB` : '—'}
      </td>
      <td className="font-mono text-[12px] py-3 pr-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span style={{ color: metrics && metrics.restarts > 0 ? 'var(--err)' : 'var(--subtle)' }}>
            {metrics ? metrics.restarts : '—'}
          </span>
          {restartSeries && (
            <RestartSparkline points={restartSeries} />
          )}
        </div>
      </td>
      <td className="py-3 pr-3">
        <Badge variant={stateBadge(c.state)} dot>{c.state}</Badge>
      </td>
      <td className="font-mono text-[12px] text-subtle py-3 pr-3">{c.status}</td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          {isConfirming ? (
            <>
              <button
                onClick={onRestart}
                className="text-[11px] font-mono transition-colors"
                style={{ color: 'var(--warn)' }}
                title="Confirm restart"
              >
                Confirm
              </button>
              <button
                onClick={onCancelRestart}
                className="text-[11px] font-mono text-subtle transition-colors"
                title="Cancel"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={onRestart}
              disabled={isRestarting}
              className="text-subtle hover:text-fg transition-colors disabled:opacity-40"
              title="Restart container"
            >
              <Icon name="refresh" size={13} />
            </button>
          )}
          {onViewLogs && (
            <button
              onClick={onViewLogs}
              className="transition-colors"
              style={{ color: isLogsActive ? 'var(--fg)' : 'var(--subtle)' }}
              title="View logs"
            >
              <Icon name="file" size={13} />
            </button>
          )}
          <Link href={logsHref} className="text-subtle hover:text-fg transition-colors">
            <Icon name="file" size={13} />
          </Link>
        </div>
      </td>
    </tr>
  )
}

export type { ContainerMetrics }
