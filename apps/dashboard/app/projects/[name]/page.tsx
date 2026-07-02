'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getApiBase } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { HealthCard } from '@/components/detail/health-card'
import { ResponseTimePanel } from '@/components/detail/response-time-panel'
import { CertPanel } from '@/components/detail/cert-panel'
import { ContainerTable } from '@/components/detail/container-table'
import { ResourceChart } from '@/components/detail/resource-chart'
import { RangeSelector } from '@/components/detail/range-selector'
import { FullChart } from '@/components/detail/full-chart'
import { NetworkChart } from '@/components/detail/network-chart'
import { QueueChart } from '@/components/detail/queue-chart'
import { DeployTimeline } from '@/components/detail/deploy-timeline'
import { IncidentPanel } from '@/components/detail/incident-panel'
import { CiTimeline } from '@/components/detail/ci-timeline'
import { DockerUsage } from '@/components/detail/docker-usage'
import { CostPanel } from '@/components/detail/cost-panel'
import { CronPanel } from '@/components/detail/cron-panel'
import { UfwPanel } from '@/components/detail/ufw-panel'
import { DeployPanel } from '@/components/deploy-panel'
import { RollbackPanel } from '@/components/rollback-panel'
import { SecretsSyncPanel } from '@/components/secrets-sync-panel'
import { DestroyModal } from '@/components/destroy-modal'
import { BackupPanel } from '@/components/detail/backup-panel'
import { PgTableSizesPanel } from '@/components/detail/pg-table-sizes-panel'
import { DiskDirsPanel } from '@/components/detail/disk-dirs-panel'
import { SecretsPanel } from '@/components/detail/secrets-panel'
import { useProjectDetail } from '@/lib/use-project-detail'

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
    polledAgo, loading, domain, repoUrl,
    variant, label,
    chartHistory, fullChartPoints, networkPoints, serverPoints,
    latestMetric, deployMarkers,
    deploys, ciRuns,
    diskTrend, memoryTrend, backupStatus, backups,
    uptimePct, fetchData, deployUrl,
  } = useProjectDetail(name)

  const [deployWarning, setDeployWarning] = useState<string | null>(null)

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
          href={`/projects/${encodeURIComponent(name)}/logs`}
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
                <HealthCard project={project} status={status} polledAgo={polledAgo} onRefresh={fetchData} uptimePct={uptimePct} latestMetric={latestMetric} />
              )}
              {status?.nginxStatus === 'active' && (
                <ResponseTimePanel name={name} />
              )}
              {status?.sslExpiry != null && (
                <CertPanel name={name} />
              )}
              {diskTrend !== null && diskTrend.projectedDaysUntilFull !== null && diskTrend.disk > 75 && (
                <div className="text-[12px] font-mono px-3 py-2 rounded-lg border" style={{ color: 'var(--warn, #e5a00d)', borderColor: 'var(--border)', background: 'var(--card-2)' }}>
                  Disk trending: +{diskTrend.pctPerDay.toFixed(1)}%/day · full in ~{Math.round(diskTrend.projectedDaysUntilFull)}d
                </div>
              )}
              {status !== null && !status?.error && (
                <DiskDirsPanel name={name} />
              )}
              {memoryTrend !== null && memoryTrend.projectedDaysUntilFull !== null && memoryTrend.mem > 75 && (
                <div className="text-[12px] font-mono px-3 py-2 rounded-lg border" style={{ color: 'var(--warn, #e5a00d)', borderColor: 'var(--border)', background: 'var(--card-2)' }}>
                  Mem trending: +{memoryTrend.pctPerDay.toFixed(1)}%/day · full in ~{Math.round(memoryTrend.projectedDaysUntilFull)}d
                </div>
              )}
              {backupStatus !== null && (() => {
                const ageHours = (Date.now() - new Date(backupStatus.lastRun).getTime()) / 3_600_000
                const failed = backupStatus.status === 'failed'
                const color = failed || ageHours >= 48 ? 'var(--err)' : ageHours >= 25 ? 'var(--warn, #e5a00d)' : 'var(--ok, #22c55e)'
                const bkpLabel = failed
                  ? `backup failed · ${Math.round(ageHours)}h ago`
                  : `backup ${Math.round(ageHours)}h ago`
                return (
                  <div className="text-[12px] font-mono px-3 py-2 rounded-lg border" style={{ color, borderColor: 'var(--border)', background: 'var(--card-2)' }}>
                    {bkpLabel}
                  </div>
                )
              })()}
              {project?.config.postgres?.backupBucket && (
                <BackupPanel project={project} backups={backups} />
              )}
              {project?.config.requiredEnvKeys != null && (
                <SecretsPanel name={name} />
              )}
              {project?.config.postgres != null && (
                <PgTableSizesPanel name={name} />
              )}
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
              {networkPoints.length >= 2 && (
                <NetworkChart points={networkPoints} deploys={deployMarkers} hours={rangeHours} />
              )}
              {serverPoints.some(p => p.queueFailed != null) && (
                <QueueChart points={serverPoints} />
              )}
              {containers !== null && (
                <ContainerTable containers={containers} projectName={name} onRefetch={fetchData} latestMetric={latestMetric} />
              )}
              <DeployTimeline deploys={deploys} name={name} repoUrl={repoUrl} />
              <IncidentPanel name={name} />
              <CiTimeline runs={ciRuns} name={name} repoUrl={repoUrl} />
              <DockerUsage projectName={name} onPrune={fetchData} />
              <CostPanel name={name} />
              {status !== null && !status?.error && (
                <CronPanel name={name} />
              )}
              {status !== null && !status?.error && (
                <UfwPanel name={name} />
              )}
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
            href={`/projects/${encodeURIComponent(name)}/logs`}
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
