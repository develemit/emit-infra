import type { FullChartPoint } from './full-chart'
import type { DeployMarker } from './resource-chart'

export interface HoverState {
  pct: number
  point: FullChartPoint
  deploy: DeployMarker | null
}

const W = 800
const H = 200

export function toPolyline(points: FullChartPoint[], key: 'cpu' | 'mem' | 'disk'): string {
  if (points.length < 2) return ''
  const t0 = points[0]!.t
  const span = (points[points.length - 1]!.t - t0) || 1
  return points
    .map(p => {
      const x = ((p.t - t0) / span) * W
      const y = (1 - p[key] / 100) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export function deployX(completedAt: string, t0: number, span: number): number {
  return ((new Date(completedAt).getTime() - t0) / span) * W
}

export function formatTimeLabel(ts: number, hours: number): string {
  const d = new Date(ts)
  if (hours <= 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function formatTooltipTime(ts: number): string {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function timeLabels(points: FullChartPoint[], hours: number): { x: number; label: string }[] {
  if (points.length < 2) return []
  const t0 = points[0]!.t
  const tEnd = points[points.length - 1]!.t
  const span = tEnd - t0 || 1
  const count = hours <= 24 ? 6 : hours <= 168 ? 7 : 6
  const labels: { x: number; label: string }[] = []
  for (let i = 0; i <= count; i++) {
    const t = t0 + (span * i) / count
    labels.push({ x: ((t - t0) / span) * W, label: formatTimeLabel(t, hours) })
  }
  return labels
}

export function filterVisibleDeploys(deploys: DeployMarker[], t0: number, span: number): DeployMarker[] {
  return (deploys ?? []).filter(d => {
    const ts = new Date(d.completedAt).getTime()
    return ts >= t0 && ts <= t0 + span
  })
}

export function getChartDimensions(): { W: typeof W; H: typeof H } {
  return { W, H }
}
