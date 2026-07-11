import type { BackupStatus, DiskTrend, MemoryTrend } from '@/lib/api'

interface AlertBannersProps {
  diskTrend: DiskTrend | null
  memoryTrend: MemoryTrend | null
  backupStatus: BackupStatus | null
}

export function AlertBanners({
  diskTrend,
  memoryTrend,
  backupStatus,
}: AlertBannersProps) {
  return (
    <>
      {diskTrend !== null &&
        diskTrend.projectedDaysUntilFull !== null &&
        diskTrend.disk > 75 && (
          <div
            className="text-[12px] font-mono px-3 py-2 rounded-lg border"
            style={{
              color: 'var(--warn, #e5a00d)',
              borderColor: 'var(--border)',
              background: 'var(--card-2)',
            }}
          >
            Disk trending: +{diskTrend.pctPerDay.toFixed(1)}%/day · full in ~
            {Math.round(diskTrend.projectedDaysUntilFull)}d
          </div>
        )}
      {memoryTrend !== null &&
        memoryTrend.projectedDaysUntilFull !== null &&
        memoryTrend.mem > 75 && (
          <div
            className="text-[12px] font-mono px-3 py-2 rounded-lg border"
            style={{
              color: 'var(--warn, #e5a00d)',
              borderColor: 'var(--border)',
              background: 'var(--card-2)',
            }}
          >
            Mem trending: +{memoryTrend.pctPerDay.toFixed(1)}%/day · full in ~
            {Math.round(memoryTrend.projectedDaysUntilFull)}d
          </div>
        )}
      {backupStatus !== null &&
        (() => {
          const ageHours =
            (Date.now() - new Date(backupStatus.lastRun).getTime()) / 3_600_000
          const failed = backupStatus.status === 'failed'
          const color =
            failed || ageHours >= 48
              ? 'var(--err)'
              : ageHours >= 25
                ? 'var(--warn, #e5a00d)'
                : null
          if (!color) return null
          return (
            <div
              className="text-[12px] font-mono px-3 py-2 rounded-lg border"
              style={{
                color,
                borderColor: 'var(--border)',
                background: 'var(--card-2)',
              }}
            >
              {failed
                ? `backup failed · ${Math.round(ageHours)}h ago`
                : `backup ${Math.round(ageHours)}h ago`}
            </div>
          )
        })()}
    </>
  )
}
