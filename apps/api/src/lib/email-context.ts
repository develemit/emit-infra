/**
 * Best-effort lookups shared by every alert-email call site. Anything that
 * can't be read yields an empty result so the email still sends with the
 * facts the caller already has.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readJsonl } from './jsonl.js'
import type { IncidentRecord } from './incidents.js'
import type { MetricPoint } from './metric-point.js'
import { computeLinearTrend, type LinearTrend } from './trend.js'
import { causeText } from './http-health.js'

const DAY_MS = 24 * 3600 * 1000

export interface IncidentSummary { atMs: number; durationMs?: number; cause?: string }

const projectFile = (name: string, file: string): string => join(homedir(), 'projects', name, file)

/** Pairs down→up records of one check type into incident rows, newest last. */
export function pairIncidents(records: IncidentRecord[]): IncidentSummary[] {
  const out: IncidentSummary[] = []
  let downAtMs: number | null = null
  for (const r of records) {
    if (r.event === 'down' && downAtMs === null) {
      downAtMs = r.t * 1000
    } else if (r.event === 'up' && downAtMs !== null) {
      out.push({ atMs: downAtMs, durationMs: r.t * 1000 - downAtMs })
      downAtMs = null
    }
  }
  if (downAtMs !== null) out.push({ atMs: downAtMs })
  return out
}

export async function incidentsLast7d(name: string, type: 'ssh' | 'http', nowMs = Date.now()): Promise<IncidentSummary[]> {
  const since = Math.floor((nowMs - 7 * DAY_MS) / 1000)
  try {
    const records = await readJsonl<IncidentRecord>(
      projectFile(name, '.incidents.jsonl'),
      (r) => typeof r.t === 'number' && r.type === type && r.t >= since,
      { tail: 10_000 },
    )
    const cause = type === 'ssh' ? 'SSH unreachable' : causeText(undefined)
    return pairIncidents(records).map((i) => ({ ...i, cause }))
  } catch {
    return []
  }
}

export async function metricsLast24h(name: string, nowMs = Date.now()): Promise<MetricPoint[]> {
  const since = Math.floor((nowMs - DAY_MS) / 1000)
  try {
    return await readJsonl<MetricPoint>(
      projectFile(name, '.metrics.jsonl'),
      (m) => typeof m.t === 'number' && m.t >= since,
      { tail: 5_000 },
    )
  } catch {
    return []
  }
}

/** Undefined when there isn't enough history for a meaningful slope. */
export async function trendLast24h(name: string, key: 'disk' | 'mem', nowMs = Date.now()): Promise<LinearTrend | undefined> {
  const points = await metricsLast24h(name, nowMs)
  return points.length < 5 ? undefined : computeLinearTrend(points, key)
}
