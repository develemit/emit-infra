'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import type { Container } from '@/lib/api'
import { restartContainer } from '@/lib/api'

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
}: {
  c: Container
  logsHref: string
  projectName: string
  onRefetch?: () => void
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
    </div>
  )
}

interface ContainerTableProps {
  containers: Container[]
  projectName: string
  onRefetch?: () => void
}

export function ContainerTable({ containers, projectName, onRefetch }: ContainerTableProps) {
  const [restartingSet, setRestartingSet] = useState<Set<string>>(new Set())
  const sorted = sortContainers(containers)
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
                  {['Name', 'Image', 'Build', 'State', 'Status', ''].map(h => (
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
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
