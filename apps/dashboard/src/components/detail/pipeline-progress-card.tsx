'use client'
import Link from 'next/link'
import { Icon } from '@/components/icon'
import { usePipelineStatus, runStateOf } from '@/lib/use-pipeline-status'
import { formatDuration } from '@/lib/format-duration'
import type { CiImageProgress, CiStatus, DeployStatus, RunState } from '@/lib/api-containers'

type Phase = 'ci' | 'deploy'
type PipelineRecord = CiStatus | DeployStatus

function elapsed(iso?: string): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  return formatDuration(s)
}

// Prefer the heartbeat age the classifier already computed; fall back to
// elapsed-since-start for pre-283 records that have no heartbeat at all.
function staleFor(status: PipelineRecord): string {
  const heartbeatAge = status.runState?.heartbeatAgeSec
  return heartbeatAge != null ? formatDuration(heartbeatAge) : elapsed(status.startedAt)
}

function hrefFor(name: string, phase: Phase, status: PipelineRecord): string {
  const logType = phase === 'deploy' ? 'deploy-log' : 'ci-log'
  return status.sha
    ? `/projects/${encodeURIComponent(name)}/${logType}/${status.sha}`
    : `/projects/${encodeURIComponent(name)}/pipelines`
}

interface Props {
  name: string
}

export function PipelineProgressCard({ name }: Props) {
  const { ci, deploy } = usePipelineStatus(name, 5_000)

  const ciState = runStateOf(ci)
  const deployState = runStateOf(deploy)
  const ciActive = ciState !== 'idle'
  const deployActive = deployState !== 'idle'

  if (!ciActive && !deployActive) return null

  const phase: Phase = deployActive ? 'deploy' : 'ci'
  const status = (deployActive ? deploy : ci) as PipelineRecord
  const state = deployActive ? deployState : ciState
  const href = hrefFor(name, phase, status)

  return state === 'running'
    ? <RunningCard phase={phase} status={status} href={href} />
    : <StalledCard phase={phase} status={status} href={href} state={state} />
}

function CardShell({ href, borderColor, children }: { href: string; borderColor: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border bg-card hover:bg-card-hover transition-colors"
      style={{ padding: 18, textDecoration: 'none', borderColor, borderWidth: 1 }}
    >
      {children}
    </Link>
  )
}

function ShaLine({ status }: { status: PipelineRecord }) {
  if (!status.sha) return null
  return (
    <div className="mt-1.5 text-[11px] font-mono text-subtle truncate">
      {status.sha.slice(0, 8)}
      {status.branch && ` · ${status.branch}`}
    </div>
  )
}

// Names the image currently building/retagging and its position among the
// real build units (sprint 339) — falls back to nothing (the coarse step
// label above still renders) for records with no `image` field, so pre-339
// history keeps rendering exactly as before.
function ImageProgressLine({ image }: { image: CiImageProgress }) {
  const verb = image.action === 'retagging' ? 'Re-tagging' : 'Building'
  return (
    <div className="mt-1 text-[11px] font-mono text-subtle truncate">
      {verb} {image.name} ({image.index}/{image.total})
    </div>
  )
}

function RunningCard({ phase, status, href }: { phase: Phase; status: PipelineRecord; href: string }) {
  const progress = status.progress
  const pct = progress?.pct ?? 0
  const label = progress?.label ?? phase
  const step = progress?.step ?? 0
  const total = progress?.total ?? 0

  return (
    <CardShell href={href} borderColor="var(--accent)">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
        <span className="text-[13.5px] font-semibold text-fg">
          {phase === 'deploy' ? 'Deploying' : 'CI Running'}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] font-mono text-subtle">{elapsed(status.startedAt)}</span>
        <Icon name="chevRight" size={14} style={{ color: 'var(--fg-muted)' }} />
      </div>

      <div className="w-full rounded-full overflow-hidden mb-2" style={{ height: 6, background: 'var(--card-2)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[12px] font-mono text-subtle">
          {label}
          {total > 0 && ` (${step}/${total})`}
        </span>
        <span className="text-[12px] font-mono font-medium" style={{ color: 'var(--accent)' }}>{pct}%</span>
      </div>
      {progress?.image && <ImageProgressLine image={progress.image} />}

      <ShaLine status={status} />
    </CardShell>
  )
}

// Not "running": either the record's writer is confirmed gone (orphaned) or
// there's no liveness evidence either way (unknown, pre-283 records). Neither
// gets a progress bar or a counting-up timer — both would falsely imply work
// is happening.
function StalledCard({ phase, status, href, state }: { phase: Phase; status: PipelineRecord; href: string; state: RunState }) {
  const orphaned = state === 'orphaned'
  const color = orphaned ? 'var(--err)' : 'var(--fg-muted)'
  const title = orphaned
    ? (phase === 'deploy' ? 'Deploy orphaned' : 'CI orphaned')
    : (phase === 'deploy' ? 'Deploy status unknown' : 'CI status unknown')
  const detail = orphaned
    ? `No heartbeat for ${staleFor(status)} — the process that started this run is gone.`
    : `Started ${elapsed(status.startedAt)} ago — no liveness data to confirm it's still running.`
  const hint = orphaned
    ? "Stuck — run `emit-infra reconcile --write` on this project to clear it."
    : "Predates liveness tracking — check the server if it looks stuck."

  return (
    <CardShell href={href} borderColor={color}>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="alert" size={14} style={{ color }} />
        <span className="text-[13.5px] font-semibold text-fg">{title}</span>
        <div className="flex-1" />
        <Icon name="chevRight" size={14} style={{ color: 'var(--fg-muted)' }} />
      </div>

      <div className="text-[12px] font-mono text-subtle mb-1">{detail}</div>
      <div className="text-[11px] font-mono" style={{ color }}>{hint}</div>

      <ShaLine status={status} />
    </CardShell>
  )
}
