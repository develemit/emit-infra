'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { getProjects } from '@/lib/api'
import type { ProjectSummary } from '@/lib/api'

export default function LogsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const router = useRouter()

  useEffect(() => {
    getProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  return (
    <div className="min-h-screen">
      {/* Desktop topbar */}
      <div className="hidden md:flex items-center gap-4 px-8 border-b border-border bg-elev" style={{ height: 56 }}>
        <Icon name="logs" size={18} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">Logs</span>
      </div>

      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-3 px-5 pt-5 pb-3">
        <Icon name="logs" size={18} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-[15px] font-semibold text-fg">Logs</span>
      </div>

      <div className="px-5 md:px-8 py-5">
        <p className="text-[12.5px] text-subtle mb-4 font-mono">Select a project to tail its live container logs.</p>

        <div className="flex flex-col gap-2 max-w-sm">
          {projects === null ? (
            <>
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-[52px] rounded-xl bg-card border border-border animate-pulse" />
              ))}
            </>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-start gap-3 px-4 py-6 rounded-xl bg-card border border-border">
              <Icon name="server" size={20} style={{ color: 'var(--fg-muted)' }} />
              <div>
                <p className="text-sm font-medium text-fg mb-1">No projects found</p>
                <p className="text-xs text-subtle">Add a project to start viewing logs.</p>
              </div>
              <Link href="/provision" className="text-xs font-mono text-accent hover:text-accent-bright transition-colors">
                Go to provision →
              </Link>
            </div>
          ) : (
            projects.map(p => (
              <button
                key={p.config.name}
                type="button"
                onClick={() => router.push(`/projects/${encodeURIComponent(p.config.name)}/logs`)}
                className="flex items-center gap-3 px-4 h-[52px] rounded-xl bg-card border border-border hover:bg-card-hover hover:border-border-strong transition-colors text-left"
              >
                <Icon name="server" size={15} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-fg">{p.config.name}</div>
                  <div className="text-[11px] font-mono text-subtle truncate">{p.config.domain}</div>
                </div>
                <Icon name="chevRight" size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
