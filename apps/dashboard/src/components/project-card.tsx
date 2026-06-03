'use client'
import Link from 'next/link'
import type { ProjectSummary, ProjectStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  project: ProjectSummary
  status: ProjectStatus | null
}

function StatusBadge({ status }: { status: ProjectStatus | null }) {
  if (!status) {
    return (
      <span className="text-xs text-gray-400 animate-pulse">checking</span>
    )
  }
  if (status.error) {
    return (
      <span className="text-xs font-medium text-red-500">unreachable</span>
    )
  }
  return (
    <span className="text-xs font-medium text-emerald-500">healthy</span>
  )
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  const color =
    pct > 85
      ? 'bg-red-500'
      : pct > 70
        ? 'bg-yellow-500'
        : 'bg-emerald-500'
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function ProjectCard({ project, status }: Props) {
  const { name, domain, region } = project.config
  const disk = status?.disk ? parseInt(status.disk, 10) : null
  const memory = status?.memory ? parseInt(status.memory, 10) : null

  return (
    <Link
      href={`/projects/${encodeURIComponent(name)}`}
      className="block rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-700 transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 mr-2">
          <h2 className="font-semibold text-sm truncate">{name}</h2>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{domain}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {status && !status.error ? (
        <div className="space-y-2.5">
          {status.uptime && (
            <p className="text-xs text-gray-500 truncate">{status.uptime}</p>
          )}
          {disk !== null && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Disk</span>
                <span>{disk}%</span>
              </div>
              <ProgressBar value={disk} />
            </div>
          )}
          {memory !== null && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Memory</span>
                <span>{memory}%</span>
              </div>
              <ProgressBar value={memory} />
            </div>
          )}
        </div>
      ) : (
        <div className="h-10" />
      )}

      <p className="text-xs text-gray-400 mt-3">{region}</p>
    </Link>
  )
}
