import type { AlertMetrics } from './alert-rules.js'

const BACKUP_LABEL = 'BACKUP|'

/** Prints one `BACKUP|<lastRun>|<status>` line; both fields are empty when
 *  the project has no status file. */
export function backupProbeCmd(name: string): string {
  const file = `/opt/${name}/.backup-status.json`
  const field = (key: string): string => `$(grep -o '"${key}":"[^"]*"' ${file} 2>/dev/null | head -1 | cut -d'"' -f4)`
  return `echo "${BACKUP_LABEL}${field('lastRun')}|${field('status')}"`
}

export type BackupMetrics = Pick<AlertMetrics, 'backupAgeHours' | 'backupFailed' | 'backupLastRunMs' | 'backupStatus'>

/** Projects without a status file yield `{}` so they never breach by omission. */
export function parseBackupSection(lines: string[], nowMs = Date.now()): BackupMetrics {
  const line = lines.find(l => l.startsWith(BACKUP_LABEL))
  if (!line) return {}
  const [lastRun = '', status = ''] = line.slice(BACKUP_LABEL.length).split('|')
  const out: BackupMetrics = {}
  const lastRunMs = lastRun ? new Date(lastRun).getTime() : NaN
  if (!isNaN(lastRunMs)) {
    out.backupAgeHours = (nowMs - lastRunMs) / 3600000
    out.backupLastRunMs = lastRunMs
  }
  if (status) {
    out.backupStatus = status
    if (status === 'failed') out.backupFailed = 1
  }
  return out
}
