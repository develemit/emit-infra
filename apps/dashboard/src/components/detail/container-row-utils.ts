import type { BadgeVariant } from '@/components/ui/badge'
import type { Container } from '@/lib/api-containers'

export interface ContainerMetrics {
  cpu: number
  memMb: number
  restarts: number
}

export function stateBadge(state: string): BadgeVariant {
  const s = state.toLowerCase()
  if (s === 'running') return 'ok'
  if (s === 'exited') return 'err'
  return 'warn'
}

export function buildLabel(c: Container): string {
  if (c.buildNumber) return `#${c.buildNumber}`
  const tag = c.image.split(':').at(-1) ?? ''
  return tag.slice(0, 8)
}

/**
 * The containers API returns the full docker name (e.g. `myapp-api-1`), but
 * collect-metrics.sh keys its per-container stats by a short name: it strips
 * the trailing replica number, then takes the last `-`-delimited segment
 * (`api`). Metrics/restart lookups must normalize through the same rule or
 * every container reads as having no data.
 */
export function shortContainerName(fullName: string): string {
  const stripped = fullName.replace(/-\d+$/, '')
  const segments = stripped.split('-')
  return segments[segments.length - 1] || stripped
}
