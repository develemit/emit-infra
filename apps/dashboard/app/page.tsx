'use client'
import { useEffect, useState, useCallback } from 'react'
import { getProjects, getStatus, type ProjectSummary, type ProjectStatus } from '@/lib/api'
import { ProjectCard } from '@/components/project-card'

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="space-y-2">
          <div className="h-4 w-28 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-800" />
        </div>
        <div className="h-3 w-14 rounded bg-gray-100 dark:bg-gray-800" />
      </div>
      <div className="space-y-2.5">
        <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800" />
        <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800" />
      </div>
    </div>
  )
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({})

  const fetchAll = useCallback(async () => {
    const ps = await getProjects()
    setProjects(ps)
    const pairs = await Promise.all(
      ps.map(async (p) => {
        const s = await getStatus(p.config.name)
        return [p.config.name, s] as const
      }),
    )
    setStatuses(Object.fromEntries(pairs))
  }, [])

  useEffect(() => {
    void fetchAll()
    const interval = setInterval(() => void fetchAll(), 30_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-semibold mb-5">Overview</h1>
      {projects === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className="text-sm text-gray-500">
          No projects found. Add a{' '}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
            .emit-infra.json
          </code>{' '}
          file to a project under <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">~/projects/</code>.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard
              key={p.config.name}
              project={p}
              status={statuses[p.config.name] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  )
}
