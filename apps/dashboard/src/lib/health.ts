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
