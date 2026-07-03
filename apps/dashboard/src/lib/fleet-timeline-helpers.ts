export const CHART_W = 600
export const LABEL_W = 100
export const LANE_H = 28
export const AXIS_H = 24

export function timeToX(tSec: number, tMin: number, tMax: number, w = CHART_W): number {
  const span = tMax - tMin || 1
  return ((tSec - tMin) / span) * w
}

export interface BarRect {
  x: number
  width: number
}

export function incidentBar(
  startedAt: number,
  resolvedAt: number | null,
  tMin: number,
  tMax: number,
  w = CHART_W,
): BarRect {
  const x = Math.max(0, timeToX(startedAt, tMin, tMax, w))
  const endSec = resolvedAt ?? tMax
  const x2 = Math.min(w, timeToX(endSec, tMin, tMax, w))
  const width = Math.max(2, x2 - x)
  return { x, width }
}

export function deployX(completedAt: string, tMin: number, tMax: number, w = CHART_W): number {
  const t = new Date(completedAt).getTime() / 1000
  return timeToX(t, tMin, tMax, w)
}

export interface TimeLabel {
  x: number
  label: string
}

export function fleetTimeLabels(tMin: number, tMax: number, days: number, w = CHART_W): TimeLabel[] {
  const count = days <= 1 ? 6 : days <= 7 ? 7 : 6
  const labels: TimeLabel[] = []
  for (let i = 0; i <= count; i++) {
    const t = tMin + ((tMax - tMin) * i) / count
    const x = (i / count) * w
    const d = new Date(t * 1000)
    const label = days <= 1
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    labels.push({ x, label })
  }
  return labels
}

export function fmtDuration(sec: number | null): string {
  if (sec === null) return 'ongoing'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}
