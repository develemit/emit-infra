import { sshCmd } from './shared.js'
import type { FindingOf, Remediation } from './types.js'

export const BACKUP_STALE_HOURS = 30

export function remediateBackup(f: FindingOf<'backup'>): Remediation {
  const failed = f.status === 'failed'
  const stale = f.ageHours !== undefined && f.ageHours > BACKUP_STALE_HOURS
  if (!failed && !stale) return { urgency: 'none', headline: 'Backups are current', steps: [] }
  const age = f.ageHours !== undefined ? `Last backup was ${Math.round(f.ageHours)}h ago` : 'Backup status unknown'
  return {
    urgency: 'now',
    headline: failed ? `${age}; last run failed` : age,
    steps: [
      { text: 'Read the backup status file.', command: sshCmd(f.serverIp, `cat /opt/${f.project}/.backup-status.json`) },
      { text: "Read the backup sidecar's logs. The container name is per project; see the project's docker-compose.prod.yml.", command: sshCmd(f.serverIp, 'docker logs --tail 50 <backup container>') },
      { text: 'Fix the cause (credentials, disk space, R2 reachability), then trigger a manual run and confirm .backup-status.json reports success.' },
    ],
  }
}
