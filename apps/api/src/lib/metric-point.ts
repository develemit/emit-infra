// Shared shape of one line in a project's .metrics.jsonl, written by the
// fleet metrics collector. Used by both history.ts (raw/downsampled series)
// and trend-routes.ts (disk/memory linear trend).
export interface MetricPoint {
  t: number
  cpu: number
  mem: number
  memUsedMb: number
  memTotalMb: number
  disk: number
  diskUsedGb: string
  diskTotalGb: string
  netRxBytes: number
  netTxBytes: number
  nginx4xx?: number
  nginx5xx?: number
  queueFailed?: number | null
  queueWait?: number | null
  containers: { name: string; cpu: number; memMb: number; restarts: number }[]
}
