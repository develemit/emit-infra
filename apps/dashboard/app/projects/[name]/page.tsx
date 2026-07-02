'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getApiBase, getSla, getScaleAdvice, type SlaData, type ScaleAdvice } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { HealthCard } from '@/components/detail/health-card'
import { ContainerTable } from '@/components/detail/container-table'
import { ResourceChart } from '@/components/detail/resource-chart'
import { RangeSelector } from '@/components/detail/range-selector'
import { FullChart } from '@/components/detail/full-chart'
import { SummaryCard } from '@/components/detail/summary-card'
import { DeployPanel } from '@/components/deploy-panel'
import { RollbackPanel } from '@/components/rollback-panel'
import { SecretsSyncPanel } from '@/components/secrets-sync-panel'
import { DestroyModal } from '@/components/destroy-modal'
import { useProjectDetail } from '@/lib/use-project-detail'

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function ProjectDetailPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''
  const apiBase = getApiBase()

  const {
    project, status, containers,
    deploying, setDeploying,
    showRollback, setShowRollback,
    showSecretsSync, setShowSecretsSync,
    showDestroy, setShowDestroy,
    rangeHours, setRangeHours,
    polledAgo, loading, domain,
    variant, label,
    chartHistory, fullChartPoints,
    latestMetric, deployMarkers,
    deploys,
    diskTrend, memoryTrend, backupStatus,
    uptimePct, fetchData, deployUrl,
  } = useProjectDetail(name)

  const [deployWarning, setDeployWarning] = useState<string | null>(null)
  const [sla, setSla] = useState<SlaData | null>(null)
  const [scaleAdvice, setScaleAdvice] = useState<ScaleAdvice | null>(null)

  useEffect(() => {
    getSla(name).then(setSla).catch(() => {})
  }, [name])

  useEffect(() => {
    getScaleAdvice(name).then(setScaleAdvice).catch(() => {})
  }, [name])

  function handleDeployClick() {
    setDeployWarning(null)
    if ((status?.disk ?? 0) >= 80 || (status?.memory ?? 0) >= 80) {
      setDeployWarning(
        `Disk at ${status?.disk ?? '?'}%, memory at ${status?.memory ?? '?'}% — server may be under pressure.`
      )
      return
    }
    setDeploying(true)
  }

  const base = `/projects/${encodeURIComponent(name)}`

  const sslDaysLeft = status?.sslExpiry != null
    ? Math.round((new Date(status.sslExpiry).getTime() - Date.now()) / 86_400_000)
    : null

  return (
    <div className="flex flex-col min-h-full">
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
        <Badge variant={variant} dot loading={variant === 'muted'}>{label}</Badge>
        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <Link
          href={`${base}/logs`}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="file" size={13} />Logs
        </Link>
        <Link
          href={`/ops?project=${encodeURIComponent(name)}`}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="zap" size={13} />Ask Claude
        </Link>
        <button
          onClick={() => setShowSecretsSync(true)}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="lock" size={13} />Sync Secrets
        </button>
        <button
          onClick={() => setShowRollback(true)}
          className="inline-flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
        >
          <Icon name="refresh" size={13} />Rollback
        </button>
        <button
          onClick={handleDeployClick}
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
        <Badge variant={variant} dot loading={variant === 'muted'}>{label}</Badge>
      </div>
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
                <HealthCard project={project} status={status} polledAgo={polledAgo} onRefresh={fetchData} uptimePct={uptimePct} latestMetric={latestMetric} scaleAdvice={scaleAdvice} />
              )}

              {/* Alert banners */}
              {diskTrend !== null && diskTrend.projectedDaysUntilFull !== null && diskTrend.disk > 75 && (
                <div className="text-[12px] font-mono px-3 py-2 rounded-lg border" style={{ color: 'var(--warn, #e5a00d)', borderColor: 'var(--border)', background: 'var(--card-2)' }}>
                  Disk trending: +{diskTrend.pctPerDay.toFixed(1)}%/day · full in ~{Math.round(diskTrend.projectedDaysUntilFull)}d
                </div>
              )}
              {memoryTrend !== null && memoryTrend.projectedDaysUntilFull !== null && memoryTrend.mem > 75 && (
                <div className="text-[12px] font-mono px-3 py-2 rounded-lg border" style={{ color: 'var(--warn, #e5a00d)', borderColor: 'var(--border)', background: 'var(--card-2)' }}>
                  Mem trending: +{memoryTrend.pctPerDay.toFixed(1)}%/day · full in ~{Math.round(memoryTrend.projectedDaysUntilFull)}d
                </div>
              )}
              {backupStatus !== null && (() => {
                const ageHours = (Date.now() - new Date(backupStatus.lastRun).getTime()) / 3_600_000
                const failed = backupStatus.status === 'failed'
                const color = failed || ageHours >= 48 ? 'var(--err)' : ageHours >= 25 ? 'var(--warn, #e5a00d)' : null
                if (!color) return null
                return (
                  <div className="text-[12px] font-mono px-3 py-2 rounded-lg border" style={{ color, borderColor: 'var(--border)', background: 'var(--card-2)' }}>
                    {failed ? `backup failed · ${Math.round(ageHours)}h ago` : `backup ${Math.round(ageHours)}h ago`}
                  </div>
                )
              })()}

              {/* Resource charts */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-fg">Health Detail</span>
                <RangeSelector value={rangeHours} onChange={setRangeHours} />
              </div>
              <ResourceChart
                name={name}
                history={chartHistory}
                deploys={deployMarkers}
                uptimePct={uptimePct}
              />
              {fullChartPoints.length >= 2 && (
                <FullChart points={fullChartPoints} deploys={deployMarkers} hours={rangeHours} />
              )}

              {/* Containers */}
              {containers !== null && (
                <ContainerTable containers={containers} projectName={name} onRefetch={fetchData} latestMetric={latestMetric} />
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <SummaryCard
                  icon="globe"
                  title="Networking"
                  href={`${base}/networking`}
                  hidden={status?.nginxStatus == null}
                  stats={[
                    { label: 'Nginx', value: status?.nginxStatus ?? '–' },
                    { label: 'SSL', value: sslDaysLeft != null ? `${sslDaysLeft}d left` : '–' },
                  ]}
                />
                <SummaryCard
                  icon="database"
                  title="Storage"
                  href={`${base}/storage`}
                  stats={[
                    { label: 'Disk', value: status?.disk != null ? `${status.disk}%` : '–', color: (status?.disk ?? 0) >= 80 ? 'var(--err)' : (status?.disk ?? 0) >= 65 ? 'var(--warn)' : undefined },
                    { label: 'Trend', value: diskTrend?.projectedDaysUntilFull != null ? `~${Math.round(diskTrend.projectedDaysUntilFull)}d full` : 'stable' },
                  ]}
                />
                <SummaryCard
                  icon="zap"
                  title="Pipelines"
                  href={`${base}/pipelines`}
                  stats={[
                    { label: 'Last deploy', value: deploys[0] ? fmtAgo(deploys[0].completedAt) : '–' },
                    { label: 'Recent', value: `${deploys.length} deploys` },
                  ]}
                />
                <SummaryCard
                  icon="shield"
                  title="Reliability"
                  href={`${base}/reliability`}
                  stats={[
                    { label: 'Uptime', value: uptimePct != null ? `${uptimePct.toFixed(1)}%` : '–', color: (uptimePct ?? 100) < 99 ? 'var(--warn)' : undefined },
                    { label: 'SLA window', value: sla ? `${sla.uptime30d.toFixed(2)}%` : '–' },
                  ]}
                />
                <SummaryCard
                  icon="lock"
                  title="Data &amp; Secrets"
                  href={`${base}/data`}
                  hidden={!project?.config.postgres?.backupBucket && project?.config.requiredEnvKeys == null}
                  stats={[
                    { label: 'Last backup', value: backupStatus ? fmtAgo(backupStatus.lastRun) : '–' },
                    { label: 'Status', value: backupStatus?.status ?? '–', color: backupStatus?.status === 'failed' ? 'var(--err)' : undefined },
                  ]}
                />
                <SummaryCard
                  icon="settings"
                  title="Administration"
                  href={`${base}/admin`}
                  stats={[
                    { label: 'Cron jobs', value: '—' },
                    { label: 'Firewall', value: '—' },
                  ]}
                />
              </div>

              {deployWarning && !deploying && (
                <div className="rounded-lg border border-warn bg-card p-3 flex items-center gap-3">
                  <span className="text-[12px] text-warn font-mono flex-1">{deployWarning}</span>
                  <button
                    onClick={() => { setDeployWarning(null); setDeploying(true) }}
                    className="px-3 h-[28px] rounded-lg text-[12px] font-medium text-warn border border-warn hover:bg-warn/10 transition-colors shrink-0"
                  >
                    Deploy anyway
                  </button>
                  <button
                    onClick={() => setDeployWarning(null)}
                    className="text-subtle hover:text-fg shrink-0 text-[12px]"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {deploying && (
                <DeployPanel
                  url={deployUrl}
                  name={name}
                  onClose={() => { setDeploying(false); setDeployWarning(null) }}
                />
              )}
              {showRollback && (
                <RollbackPanel
                  name={name}
                  onClose={() => setShowRollback(false)}
                />
              )}
              {showSecretsSync && (
                <SecretsSyncPanel
                  name={name}
                  onClose={() => setShowSecretsSync(false)}
                />
              )}
            </>
          )}
        </div>
      </div>
      <div
        className="lg:hidden fixed bottom-16 left-0 right-0 z-40 flex flex-col gap-2 px-4 py-3 border-t border-border bg-elev"
      >
        <button
          onClick={handleDeployClick}
          disabled={deploying}
          className="flex w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium text-accent-fg bg-accent hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ height: 48 }}
        >
          <Icon name="deploy" size={16} />{deploying ? 'Running…' : 'Deploy'}
        </button>
        <div className="flex gap-2">
          <Link
            href={`${base}/logs`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
            style={{ height: 44 }}
          >
            <Icon name="file" size={14} />Logs
          </Link>
          <button
            onClick={() => setShowSecretsSync(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
            style={{ height: 44 }}
          >
            <Icon name="lock" size={14} />Secrets
          </button>
          <button
            onClick={() => setShowRollback(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
            style={{ height: 44 }}
          >
            <Icon name="refresh" size={14} />Rollback
          </button>
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
