'use client'
import { useParams } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { getStatus, getContainers, getProjects, getApiBase, type ProjectSummary, type ProjectStatus, type Container } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { HealthCard } from '@/components/detail/health-card'
import { ContainerTable } from '@/components/detail/container-table'
import { DeployPanel } from '@/components/deploy-panel'
import { DestroyModal } from '@/components/destroy-modal'

function deriveVariant(status: ProjectStatus | null): BadgeVariant {
  if (status === null) return 'muted'
  if (status.error) return 'err'
  const disk = status.disk ?? 0
  const mem = status.memory ?? 0
  if (disk >= 80 || mem >= 80) return 'warn'
  return 'ok'
}

const variantLabel: Record<BadgeVariant, string> = {
  ok: 'Healthy', warn: 'Degraded', err: 'Unreachable',
  muted: 'Loading', accent: 'Accent', region: 'Region',
}

export default function ProjectDetailPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''
  const apiBase = getApiBase()

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [status, setStatus] = useState<ProjectStatus | null>(null)
  const [containers, setContainers] = useState<Container[] | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [showDestroy, setShowDestroy] = useState(false)

  const deployUrl = `${apiBase}/projects/${encodeURIComponent(name)}/deploy`

  const fetchData = useCallback(async () => {
    const [ps, s, c] = await Promise.all([getProjects(), getStatus(name), getContainers(name)])
    setProject(ps.find(p => p.config.name === name) ?? null)
    setStatus(s)
    setContainers(c)
  }, [name])

  useEffect(() => {
    void fetchData()
    const interval = setInterval(() => void fetchData(), 30_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const variant = deriveVariant(status)
  const domain = project?.config.domain ?? ''
  const loading = status === null

  return (
    <div className="flex flex-col min-h-full">
      {/* Desktop topbar */}
      <div
        className="hidden lg:flex items-center gap-3 px-6 border-b border-border shrink-0"
        style={{ height: 56 }}
      >
        <Link href="/" className="text-subtle hover:text-fg transition-colors">
          <Icon name="arrowLeft" size={16} />
        </Link>
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-fg">{name}</span>
          {domain && <span className="text-[11px] font-mono text-subtle">{domain}</span>}
        </div>
        <div className="flex-1" />
        <Badge variant={variant} dot loading={variant === 'muted'}>{variantLabel[variant]}</Badge>
        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <Link
          href={`/projects/${encodeURIComponent(name)}/logs`}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="file" size={13} />Logs
        </Link>
        <button
          onClick={() => setDeploying(true)}
          disabled={deploying}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Icon name="deploy" size={13} />{deploying ? 'Running…' : 'Deploy'}
        </button>
        <button
          onClick={() => setShowDestroy(true)}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-err border border-err-line hover:bg-err-soft transition-colors"
        >
          <Icon name="trash" size={13} />Destroy
        </button>
      </div>

      {/* Mobile sticky header */}
      <div
        className="lg:hidden sticky top-0 z-40 flex items-center gap-2.5 px-4 border-b border-border bg-elev"
        style={{ height: 52 }}
      >
        <Link href="/" className="text-subtle"><Icon name="arrowLeft" size={18} /></Link>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-fg truncate">{name}</div>
          {domain && <div className="text-[10.5px] font-mono text-subtle truncate">{domain}</div>}
        </div>
        <div className="flex-1" />
        <Badge variant={variant} dot loading={variant === 'muted'}>{variantLabel[variant]}</Badge>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 lg:p-6 pb-[160px] lg:pb-6">
        <div className="flex flex-col gap-4 max-w-[1000px]">
          {loading ? (
            <>
              <Skeleton className="h-[200px]" />
              <Skeleton className="h-[220px]" />
            </>
          ) : status?.error ? (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-err border border-err-line bg-err-soft">
              <Icon name="alert" size={16} />
              SSH unreachable — the server did not respond
            </div>
          ) : (
            <>
              {project && status && (
                <HealthCard project={project} status={status} polledAgo="polled 30s ago" />
              )}
              {containers !== null && (
                <ContainerTable containers={containers} projectName={name} />
              )}
              {deploying && (
                <DeployPanel
                  url={deployUrl}
                  name={name}
                  onClose={() => setDeploying(false)}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile sticky footer (above tab bar) */}
      <div
        className="lg:hidden fixed bottom-16 left-0 right-0 z-40 flex flex-col gap-2 px-4 py-3 border-t border-border bg-elev"
      >
        <button
          onClick={() => setDeploying(true)}
          disabled={deploying}
          className="flex w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ height: 48 }}
        >
          <Icon name="deploy" size={16} />{deploying ? 'Running…' : 'Deploy'}
        </button>
        <div className="flex gap-2">
          <Link
            href={`/projects/${encodeURIComponent(name)}/logs`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
            style={{ height: 44 }}
          >
            <Icon name="file" size={14} />Logs
          </Link>
          <button
            onClick={() => setShowDestroy(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium text-err border border-err-line hover:bg-err-soft transition-colors"
            style={{ height: 44 }}
          >
            <Icon name="trash" size={14} />Destroy
          </button>
        </div>
      </div>

      {showDestroy && (
        <DestroyModal
          projectName={name}
          apiBase={apiBase}
          onClose={() => setShowDestroy(false)}
        />
      )}
    </div>
  )
}
