'use client'
import { useEffect, useState, useCallback } from 'react'
import { getProjects, getStatus, type ProjectSummary, type ProjectStatus } from '@/lib/api'
import { ProjectCard } from '@/components/project-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Icon } from '@/components/icon'
import { AddProjectDropdown } from '@/components/add-project-dropdown'

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({})
  const [search, setSearch] = useState('')

  const fetchAll = useCallback(async () => {
    const ps = await getProjects()
    setProjects(ps)
    window.dispatchEvent(new Event('emit:ready'))
    ps.forEach((p) => {
      void getStatus(p.config.name).then(
        (s) => setStatuses((prev) => ({ ...prev, [p.config.name]: s })),
        () => setStatuses((prev) => ({ ...prev, [p.config.name]: { error: 'unreachable' } })),
      )
    })
  }, [])

  useEffect(() => {
    void fetchAll()
    const interval = setInterval(() => void fetchAll(), 30_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const filtered = projects?.filter(p =>
    !search || p.config.name.includes(search) || p.config.domain.includes(search),
  )

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
        <AddProjectDropdown onRegistered={() => void fetchAll()} />
      </div>

      {/* Mobile header */}
      <div
        className="md:hidden flex items-center justify-between px-4 border-b border-border shrink-0"
        style={{ height: 52 }}
      >
        <span className="text-[17px] font-semibold text-fg">Projects</span>
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
