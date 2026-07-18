import type { ProjectStatus } from '@/lib/api-projects'
import type { DeployHistoryEntry, CiHistoryEntry } from '@/lib/api-history'
import { formatAgo } from '@/lib/date-helpers'

export function genId() {
  return Math.random().toString(36).slice(2)
}

export function getConfirmText(toolName: string, projectName: string) {
  if (toolName === 'destroy') return {
    subtitle: `Destroy ${projectName}`,
    description: 'This will permanently destroy all Hetzner infrastructure. This action cannot be undone.',
  }
  if (toolName === 'provision') return {
    subtitle: `Provision ${projectName}`,
    description: 'Creates new infrastructure on Hetzner via Terraform and configures it with Ansible.',
  }
  return {
    subtitle: `Deploy ${projectName}`,
    description: 'Runs Ansible to pull the latest code and restart application containers.',
  }
}

export function buildContextString(
  name: string,
  domain: string,
  status: ProjectStatus,
  deploys: DeployHistoryEntry[] = [],
  ciRuns: CiHistoryEntry[] = [],
): string {
  const lines: (string | null)[] = [
    `Project: ${name}  Domain: ${domain}`,
  ]

  const statusParts = [
    status.httpStatus ? `HTTP ${status.httpStatus}` : null,
    status.disk != null ? `Disk: ${status.disk}%` : null,
    status.memory != null ? `Mem: ${status.memory}%` : null,
    status.sslExpiry ? `SSL: ${status.sslExpiry}` : null,
    status.nginxStatus ? `Nginx: ${status.nginxStatus}` : null,
    status.redisStatus ? `Redis: ${status.redisStatus}` : null,
  ]
  if (statusParts.some(p => p)) {
    lines.push(`Status: ${statusParts.filter(Boolean).join('  ')}`)
  }

  if (deploys.length > 0) {
    const last = deploys[0]!
    const shaShort = last.sha.slice(0, 7)
    const time = formatAgo(last.completedAt)
    lines.push(`Last deploy: ${shaShort} (${last.branch}) ${last.durationSec}s ${last.status} — "${last.message || 'no message'}"  ${time}`)
  }

  if (deploys.length > 0) {
    const succeeded = deploys.filter(d => d.status === 'success').length
    lines.push(`Deploy health: ${succeeded}/${Math.min(3, deploys.length)} recent succeeded`)
  }

  if (ciRuns.length > 0) {
    const passed = ciRuns.filter(r => r.status === 'success').length
    const avgDuration = Math.round(ciRuns.reduce((sum, r) => sum + r.durationSec, 0) / ciRuns.length)
    lines.push(`CI health: ${passed}/${Math.min(10, ciRuns.length)} recent passed  Avg: ${avgDuration}s`)
  }

  return lines.filter(Boolean).join('\n')
}
