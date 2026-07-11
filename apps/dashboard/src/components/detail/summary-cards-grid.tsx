import type { BackupStatus, DiskTrend, ProjectStatus, DeployHistoryEntry } from '@/lib/api'
import { SummaryCard } from '@/components/detail/summary-card'
import { fmtAgo } from '@/lib/project-detail-helpers'

interface SummaryCardsGridProps {
  base: string
  status: ProjectStatus | null
  sslDaysLeft: number | null
  diskTrend: DiskTrend | null
  deploys: DeployHistoryEntry[]
  uptimePct: number | null
  sla: { uptime30d: number } | null
  backupStatus: BackupStatus | null
  project: {
    config: {
      postgres?: { backupBucket?: string }
      requiredEnvKeys?: unknown
    }
  } | null
}

export function SummaryCardsGrid({
  base,
  status,
  sslDaysLeft,
  diskTrend,
  deploys,
  uptimePct,
  sla,
  backupStatus,
  project,
}: SummaryCardsGridProps) {
  return (
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
          {
            label: 'Disk',
            value: status?.disk != null ? `${status.disk}%` : '–',
            color:
              (status?.disk ?? 0) >= 80
                ? 'var(--err)'
                : (status?.disk ?? 0) >= 65
                  ? 'var(--warn)'
                  : undefined,
          },
          {
            label: 'Trend',
            value:
              diskTrend?.projectedDaysUntilFull != null
                ? `~${Math.round(diskTrend.projectedDaysUntilFull)}d full`
                : 'stable',
          },
        ]}
      />
      <SummaryCard
        icon="zap"
        title="Pipelines"
        href={`${base}/pipelines`}
        stats={[
          {
            label: 'Last deploy',
            value: deploys[0] ? fmtAgo(deploys[0].completedAt) : '–',
          },
          { label: 'Recent', value: `${deploys.length} deploys` },
        ]}
      />
      <SummaryCard
        icon="shield"
        title="Reliability"
        href={`${base}/reliability`}
        stats={[
          {
            label: 'Uptime',
            value: uptimePct != null ? `${uptimePct.toFixed(1)}%` : '–',
            color: (uptimePct ?? 100) < 99 ? 'var(--warn)' : undefined,
          },
          { label: 'SLA window', value: sla ? `${sla.uptime30d.toFixed(2)}%` : '–' },
        ]}
      />
      <SummaryCard
        icon="lock"
        title="Data &amp; Secrets"
        href={`${base}/data`}
        hidden={
          !project?.config.postgres?.backupBucket &&
          project?.config.requiredEnvKeys == null
        }
        stats={[
          {
            label: 'Last backup',
            value: backupStatus ? fmtAgo(backupStatus.lastRun) : '–',
          },
          {
            label: 'Status',
            value: backupStatus?.status ?? '–',
            color: backupStatus?.status === 'failed' ? 'var(--err)' : undefined,
          },
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
  )
}
