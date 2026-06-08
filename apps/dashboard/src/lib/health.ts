import type { BadgeVariant } from '@/components/ui/badge'
import type { ProjectStatus } from './api'

export interface HealthResult {
  variant: BadgeVariant
  label: string
}

export function deriveHealth(status: ProjectStatus | null): HealthResult {
  if (status === null) return { variant: 'muted', label: 'Loading' }
  if (status.error) return { variant: 'err', label: 'Unreachable' }

  const disk = status.disk ?? 0
  const mem = status.memory ?? 0
  const unhealthy = status.containerUnhealthy ?? 0
  const http = status.httpStatus

  const httpChecked = http !== undefined
  const siteDown = httpChecked && (http === null || http >= 500)

  if (siteDown) return { variant: 'err', label: 'Down' }
  if (unhealthy > 0) return { variant: 'warn', label: 'Degraded' }
  if (disk >= 80 || mem >= 80) return { variant: 'warn', label: 'Degraded' }

  return { variant: 'ok', label: 'Healthy' }
}
