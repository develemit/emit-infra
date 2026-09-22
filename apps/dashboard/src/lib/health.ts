import type { BadgeVariant } from '@/components/ui/badge'
import type { ProjectStatus } from './api'

export interface HealthResult {
  variant: BadgeVariant
  label: string
}

export function deriveHealth(
  status: ProjectStatus | null,
  thresholds?: { diskPct?: number; memPct?: number },
): HealthResult {
  if (status === null) return { variant: 'muted', label: 'Loading' }
  if (status.error) return { variant: 'err', label: 'Unreachable' }

  const disk = status.disk ?? 0
  const mem = status.memory ?? 0
  const unhealthy = status.containerUnhealthy ?? 0
  const http = status.httpStatus

  const httpChecked = http !== undefined
  const siteDown = httpChecked && (http === null || http >= 500)

  const diskThreshold = thresholds?.diskPct ?? 80
  const memThreshold = thresholds?.memPct ?? 80

  if (siteDown) return { variant: 'err', label: 'Down' }
  if (unhealthy > 0) return { variant: 'warn', label: 'Degraded' }
  if (disk >= diskThreshold || mem >= memThreshold) return { variant: 'warn', label: 'Degraded' }

  return { variant: 'ok', label: 'Healthy' }
}

export interface FleetStatusSummary {
  loaded: boolean
  healthy: number
  total: number
  color: string
}

/**
 * Waits for every project's status to resolve before reporting a count.
 * Reporting partial counts mid-load makes a healthy fleet look like it's
 * half down for the second or two it takes statuses to trickle in.
 */
export function fleetStatusSummary(
  names: string[],
  statuses: Record<string, ProjectStatus>,
): FleetStatusSummary {
  const total = names.length
  const loaded = names.every(name => statuses[name] !== undefined)
  if (!loaded) return { loaded: false, healthy: 0, total, color: 'var(--fg-muted)' }

  const healthy = names.filter(name => !statuses[name].error).length
  const color =
    healthy === total ? 'var(--ok, #22c55e)' : healthy >= total * 0.5 ? '#f59e0b' : 'var(--err)'
  return { loaded: true, healthy, total, color }
}
