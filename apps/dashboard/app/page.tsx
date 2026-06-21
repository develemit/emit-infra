'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { getProjects, getStatus, type ProjectSummary, type ProjectStatus } from '@/lib/api'
import { usePipelineRunningCount } from '@/lib/use-pipeline-running-count'
import { ProjectCard } from '@/components/project-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Icon } from '@/components/icon'
import { AddProjectDropdown } from '@/components/add-project-dropdown'
import { BillingWidget } from '@/components/billing-widget'
import { PushSubscribeButton } from '@/components/push-subscribe-button'

function notifyDown(name: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  new Notification(`${name} is down`, {
    body: 'SSH unreachable — check the server.',
    tag: `down-${name}`,
  })
}

function notifyUp(name: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  new Notification(`${name} is back online`, {
    body: 'SSH reachable — server has recovered.',
    tag: `up-${name}`,
  })
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({})
  const [search, setSearch] = useState('')
  const prevStatuses = useRef<Record<string, ProjectStatus>>({})
  const { ciRunning, deployRunning } = usePipelineRunningCount(projects)

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  const fetchAll = useCallback(async () => {
    const ps = await getProjects()
    setProjects(ps)
    window.dispatchEvent(new Event('emit:ready'))

    const settled = await Promise.allSettled(
      ps.map((p) =>
        getStatus(p.config.name).then(
          (s) => ({ name: p.config.name, status: s }),
          () => ({ name: p.config.name, status: { error: 'unreachable' } as ProjectStatus }),
        ),
      ),
    )

    const newStatuses: Record<string, ProjectStatus> = {}
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        newStatuses[r.value.name] = r.value.status
      }
    }

    for (const [name, newStatus] of Object.entries(newStatuses)) {
      const prev = prevStatuses.current[name]
      if (prev && !prev.error && newStatus.error) {
        notifyDown(name)
      }
      if (prev?.error && !newStatus.error) {
        notifyUp(name)
      }
    }

    prevStatuses.current = newStatuses
    setStatuses(newStatuses)
  }, [])

  useEffect(() => {
    void fetchAll()
    const interval = setInterval(() => void fetchAll(), 30_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const filtered = projects?.filter(
    (p) => !search || p.config.name.includes(search) || p.config.domain.includes(search),
  )

  const statusesLoaded = projects !== null && Object.keys(statuses).length > 0
  const total = projects?.length ?? 0
  const healthy = projects?.filter(p => statuses[p.config.name] && !statuses[p.config.name].error).length ?? 0
  const healthColor = healthy === total ? 'var(--ok, #22c55e)' : healthy >= total * 0.5 ? '#f59e0b' : 'var(--err)'
  const summaryParts: string[] = [`${healthy} / ${total} healthy`]
  if (ciRunning > 0) summaryParts.push(`${ciRunning} CI running`)
  if (deployRunning > 0) summaryParts.push(`${deployRunning} deploying`)
  const summaryText = summaryParts.join(' · ')

  return (
    <div className="flex flex-col h-full">
      {/* Desktop topbar */}
      <div
        className="hidden md:flex items-center gap-3 px-6 border-b border-border shrink-0"
        style={{ height: 56 }}
      >
        <span className="text-[15px] font-semibold text-fg">Projects</span>
        <div className="text-[12px] font-mono text-subtle">
          {projects ? `${projects.length} managed` : '—'}
        </div>
        {statusesLoaded && (
          <div className="text-[12px] font-mono" style={{ color: healthColor }}>
            {summaryText}
          </div>
        )}
        <div className="flex-1" />
        {/* Search */}
        <div className="relative flex items-center" style={{ width: 200, height: 34 }}>
          <span className="absolute left-2.5 text-subtle pointer-events-none">
            <Icon name="search" size={14} />
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="filter…"
            className="w-full h-full rounded-lg pl-8 pr-3 text-[12px] font-mono text-fg bg-card border border-border focus:outline-none focus:border-accent"
          />
        </div>
        <PushSubscribeButton />
        <AddProjectDropdown onRegistered={() => void fetchAll()} />
      </div>

      {/* Mobile header */}
      <div
        className="md:hidden flex items-center justify-between px-4 border-b border-border shrink-0"
        style={{ height: 52 }}
      >
        <div className="flex flex-col">
          <span className="text-[17px] font-semibold text-fg">Projects</span>
          {statusesLoaded && (
            <div className="text-[11px] font-mono text-subtle mt-0.5">{summaryText}</div>
          )}
        </div>
        <AddProjectDropdown onRegistered={() => void fetchAll()} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {projects === null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[180px]" />
            ))}
          </div>
        ) : (filtered ?? []).length === 0 ? (
          <p className="text-sm text-subtle">
            {search ? 'No projects match your filter.' : 'No projects found. Add a .emit-infra.json file to a project under ~/projects/.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {(filtered ?? []).map((p) => (
              <ProjectCard
                key={p.config.name}
                project={p}
                status={statuses[p.config.name] ?? null}
                onRetry={async () => {
                  const s = await getStatus(p.config.name).catch(() => ({ error: 'unreachable' } as ProjectStatus))
                  setStatuses(prev => ({ ...prev, [p.config.name]: s }))
                }}
              />
            ))}
          </div>
        )}
        <div className="mt-4 md:mt-6">
          <BillingWidget />
        </div>
      </div>
    </div>
  )
}
