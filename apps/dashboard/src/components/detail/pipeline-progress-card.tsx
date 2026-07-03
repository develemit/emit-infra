'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { getCiStatus, getDeployStatus, type CiStatus, type DeployStatus } from '@/lib/api-containers'

function usePipelinePolling(name: string) {
  const [ci, setCi] = useState<CiStatus | null>(null)
  const [deploy, setDeploy] = useState<DeployStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      const [c, d] = await Promise.all([getCiStatus(name), getDeployStatus(name)])
      if (!cancelled) { setCi(c); setDeploy(d) }
    }
    void poll()
    const id = setInterval(() => void poll(), 5_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [name])

  return { ci, deploy }
}

function elapsed(iso?: string): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

interface Props {
  name: string
}

export function PipelineProgressCard({ name }: Props) {
  const { ci, deploy } = usePipelinePolling(name)

  const ciRunning = ci?.status === 'running'
  const deployRunning = deploy?.status === 'deploying' || deploy?.status === 'running'

  if (!ciRunning && !deployRunning) return null

  const phase = deployRunning ? 'deploy' : 'ci'
  const status = deployRunning ? deploy! : ci!
  const progress = status.progress
  const pct = progress?.pct ?? 0
  const label = progress?.label ?? phase
  const step = progress?.step ?? 0
  const total = progress?.total ?? 0

  const logType = phase === 'deploy' ? 'deploy-log' : 'ci-log'
  const href = status.sha
    ? `/projects/${encodeURIComponent(name)}/${logType}/${status.sha}`
    : `/projects/${encodeURIComponent(name)}/pipelines`

  return (
    <Link
      href={href}
      className="block rounded-xl border bg-card hover:bg-card-hover transition-colors"
      style={{
        padding: 18,
        textDecoration: 'none',
        borderColor: 'var(--accent)',
        borderWidth: 1,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ background: 'var(--accent)' }}
        />
        <span className="text-[13.5px] font-semibold text-fg">
          {phase === 'deploy' ? 'Deploying' : 'CI Running'}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] font-mono text-subtle">
          {elapsed(status.startedAt)}
        </span>
        <Icon name="chevRight" size={14} style={{ color: 'var(--fg-muted)' }} />
      </div>

      {/* Progress bar */}
      <div
        className="w-full rounded-full overflow-hidden mb-2"
        style={{ height: 6, background: 'var(--card-2)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: 'var(--accent)' }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] font-mono text-subtle">
          {label}
          {total > 0 && ` (${step}/${total})`}
        </span>
        <span
          className="text-[12px] font-mono font-medium"
          style={{ color: 'var(--accent)' }}
        >
          {pct}%
        </span>
      </div>

      {status.sha && (
        <div className="mt-1.5 text-[11px] font-mono text-subtle truncate">
          {status.sha.slice(0, 8)}
          {status.branch && ` · ${status.branch}`}
        </div>
      )}
    </Link>
  )
}
