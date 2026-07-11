'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getApiBase, getSla, getScaleAdvice, type SlaData, type ScaleAdvice } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { HealthCard } from '@/components/detail/health-card'
import { ContainerTable } from '@/components/detail/container-table'
import { ResourceChart } from '@/components/detail/resource-chart'
import { RangeSelector } from '@/components/detail/range-selector'
import { FullChart } from '@/components/detail/full-chart'
import { DeployPanel } from '@/components/deploy-panel'
import { RollbackPanel } from '@/components/rollback-panel'
import { SecretsSyncPanel } from '@/components/secrets-sync-panel'
import { DestroyModal } from '@/components/destroy-modal'
import { useProjectDetail } from '@/lib/use-project-detail'
import { PipelineProgressCard } from '@/components/detail/pipeline-progress-card'
import { ProjectHeader } from '@/components/detail/project-header'
import { AlertBanners } from '@/components/detail/alert-banners'
import { SummaryCardsGrid } from '@/components/detail/summary-cards-grid'
import { getSslDaysLeft } from '@/lib/project-detail-helpers'

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

  const sslDaysLeft = getSslDaysLeft(status?.sslExpiry)

  return (
    <div className="flex flex-col min-h-full">
      <ProjectHeader
        name={name}
        domain={domain}
        variant={variant}
        label={label}
        base={base}
        deploying={deploying}
        onDeployClick={handleDeployClick}
        onRollbackClick={() => setShowRollback(true)}
        onSecretsSyncClick={() => setShowSecretsSync(true)}
        onDestroyClick={() => setShowDestroy(true)}
      />
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

              <PipelineProgressCard name={name} />

              <AlertBanners
                diskTrend={diskTrend}
                memoryTrend={memoryTrend}
                backupStatus={backupStatus}
              />

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

              <SummaryCardsGrid
                base={base}
                status={status}
                sslDaysLeft={sslDaysLeft}
                diskTrend={diskTrend}
                deploys={deploys}
                uptimePct={uptimePct}
                sla={sla}
                backupStatus={backupStatus}
                project={project}
              />

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
