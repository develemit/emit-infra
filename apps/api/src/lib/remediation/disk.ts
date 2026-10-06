import { sshCmd } from './shared.js'
import type { FindingOf, Remediation } from './types.js'

export const DISK_SOON_PCT = 80
export const DISK_NOW_PCT = 90
export const DISK_PROJECTED_DAYS_NOW = 7

export function remediateDisk(f: FindingOf<'disk'>): Remediation {
  const pct = Math.round(f.pct)
  const fullSoon = f.projectedDaysUntilFull != null && f.projectedDaysUntilFull < DISK_PROJECTED_DAYS_NOW
  if (f.pct < DISK_SOON_PCT && !fullSoon) return { urgency: 'none', headline: `Disk at ${pct}% is healthy`, steps: [] }
  const urgency = f.pct >= DISK_NOW_PCT || fullSoon ? 'now' : 'soon'
  const projection = fullSoon ? `, projected full in ~${Math.max(0, Math.round(f.projectedDaysUntilFull!))} days` : ''
  return {
    urgency,
    headline: `Disk at ${pct}%${projection}`,
    steps: [
      {
        text: 'See what is using space. Image bytes live in /var/lib/containerd on these servers, not /var/lib/docker.',
        command: sshCmd(f.serverIp, 'docker system df && du -xh /var/lib/containerd /var/lib/docker --max-depth=1 2>/dev/null | sort -h | tail'),
      },
      {
        text: 'Prune stopped containers and images older than 24h. Running and rollback-slot images are never touched.',
        command: sshCmd(f.serverIp, 'docker container prune -f --filter "until=24h" && docker image prune -a -f --filter "until=24h"'),
      },
      { text: 'If images are not the culprit, check container logs and database volume growth under /var/lib/docker/volumes.' },
      { text: 'If disk is still above 85% after pruning, resize the server.', link: 'docs/scaling.md' },
    ],
  }
}
