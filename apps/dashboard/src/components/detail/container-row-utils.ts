import type { BadgeVariant } from '@/components/ui/badge'
import type { Container } from '@/lib/api'

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
