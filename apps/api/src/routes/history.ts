import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod/v4'
import { readJsonl, downsample } from '../lib/jsonl.js'
import { findProject } from '../lib/project-helpers.js'
import { createTtlCache } from '../lib/ttl-cache.js'

const NameParam = z.object({ name: z.string().min(1).max(100) })
const ShaParam = z.object({
  name: z.string().min(1).max(100),
  sha: z.string().min(7).max(40).regex(/^[a-f0-9]+$/, 'invalid sha'),
})
const HoursQuery = z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) })
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
const DaysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) })

interface MetricPoint {
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

interface DeployHistoryEntry {
  status: string
  sha: string
  branch: string
  startedAt: string
  completedAt: string
  durationSec: number
  servicesBuilt: string[]
  message?: string
}

interface CiHistoryEntry {
  status: string
  sha: string
  branch: string
  startedAt: string
  completedAt: string
  durationSec: number
  message?: string
}

interface IncidentRecord {
  type: 'ssh' | 'http'
  projectName: string
  event: 'down' | 'up'
  t: number
}

interface Incident {
  startedAt: number
  resolvedAt: number | null
  durationSec: number | null
  resolved: boolean
}

const MAX_METRIC_POINTS = 500
const MAX_HOURS = 720
const MAX_HISTORY_LIMIT = 200

interface SlaData {
  uptime7d: number
  uptime30d: number
}

const slaCache = createTtlCache<SlaData>(120_000)

function pairIncidents(records: IncidentRecord[]): Incident[] {
  const incidents: Incident[] = []
  let openDownAt: number | null = null
  for (const record of records) {
    if (record.event === 'down') {
      if (openDownAt === null) openDownAt = record.t
    } else if (record.event === 'up') {
      if (openDownAt !== null) {
        incidents.push({ startedAt: openDownAt, resolvedAt: record.t, durationSec: record.t - openDownAt, resolved: true })
        openDownAt = null
      }
    }
  }
  if (openDownAt !== null) {
    incidents.push({ startedAt: openDownAt, resolvedAt: null, durationSec: null, resolved: false })
  }
  return incidents
}

export async function historyRoutes(app: FastifyInstance) {
  app.get('/projects/:name/metrics', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const query = HoursQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const hours = query.data.hours
    const cutoff = Math.floor(Date.now() / 1000) - hours * 3600
    const filePath = join(homedir(), 'projects', params.data.name, '.metrics.jsonl')

    const points = await readJsonl<MetricPoint>(
      filePath,
      (p) => typeof p.t === 'number' && p.t >= cutoff && !('error' in p),
    )

    const downsampled = downsample(points, MAX_METRIC_POINTS)
    const from = points.length > 0 ? points[0]!.t : cutoff
    const to = points.length > 0 ? points[points.length - 1]!.t : Math.floor(Date.now() / 1000)

    return { points: downsampled, range: { from, to } }
  })

  app.get('/projects/:name/deploy-history', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const query = LimitQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const filePath = join(homedir(), 'projects', params.data.name, '.deploy-history.jsonl')
    const all = await readJsonl<DeployHistoryEntry>(filePath)
    const deploys = all.slice(-query.data.limit).reverse()

    return { deploys }
  })

  app.get('/projects/:name/ci-history', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const query = LimitQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const filePath = join(homedir(), 'projects', params.data.name, '.ci-history.jsonl')
    const all = await readJsonl<CiHistoryEntry>(filePath)
    const runs = all.slice(-query.data.limit).reverse()

    return { runs }
  })

  app.get(
    '/projects/:name/ci-log/:sha',
    async (req, reply) => {
      const params = ShaParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: params.error.message })
      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'not found' })
      const filePath = join(homedir(), 'projects', params.data.name, '.ci-logs', `${params.data.sha}.log`)
      try {
        const content = await readFile(filePath, 'utf8')
        return reply.type('text/plain').send(content)
      } catch {
        return reply.status(404).send({ error: 'log not found' })
      }
    },
  )

  app.get(
    '/projects/:name/deploy-log/:sha',
    async (req, reply) => {
      const params = ShaParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: params.error.message })
      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'not found' })
      const filePath = join(homedir(), 'projects', params.data.name, '.deploy-logs', `${params.data.sha}.log`)
      try {
        const content = await readFile(filePath, 'utf8')
        return reply.type('text/plain').send(content)
      } catch {
        return reply.status(404).send({ error: 'log not found' })
      }
    },
  )

  app.get(
    '/projects/:name/disk-trend',
    async (req, reply) => {
      const params = NameParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: params.error.message })
      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 3600
      const filePath = join(homedir(), 'projects', params.data.name, '.metrics.jsonl')
      const points = await readJsonl<MetricPoint>(
        filePath,
        (p) => typeof p.t === 'number' && p.t >= cutoff && typeof p.disk === 'number' && !('error' in p),
      )

      if (points.length < 5) {
        return { disk: points[points.length - 1]?.disk ?? 0, pctPerDay: 0, projectedDaysUntilFull: null }
      }

      const n = points.length
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
      for (const p of points) {
        sumX += p.t
        sumY += p.disk
        sumXY += p.t * p.disk
        sumX2 += p.t * p.t
      }
      const denom = n * sumX2 - sumX * sumX
      const slopePerSec = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
      const pctPerDay = slopePerSec * 86400
      const currentDisk = points[points.length - 1]!.disk

      const projectedDaysUntilFull = pctPerDay <= 0
        ? null
        : (100 - currentDisk) / pctPerDay

      return { disk: currentDisk, pctPerDay, projectedDaysUntilFull }
    },
  )

  app.get(
    '/projects/:name/memory-trend',
    async (req, reply) => {
      const params = NameParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: params.error.message })
      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'not found' })

      const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 3600
      const filePath = join(homedir(), 'projects', params.data.name, '.metrics.jsonl')
      const points = await readJsonl<MetricPoint>(
        filePath,
        (p) => typeof p.t === 'number' && p.t >= cutoff && typeof p.mem === 'number' && !('error' in p),
      )

      if (points.length < 5) {
        return { mem: points[points.length - 1]?.mem ?? 0, pctPerDay: 0, projectedDaysUntilFull: null }
      }

      const n = points.length
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
      for (const p of points) {
        sumX += p.t
        sumY += p.mem
        sumXY += p.t * p.mem
        sumX2 += p.t * p.t
      }
      const denom = n * sumX2 - sumX * sumX
      const slopePerSec = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
      const pctPerDay = slopePerSec * 86400
      const currentMem = points[points.length - 1]!.mem

      const projectedDaysUntilFull = pctPerDay <= 0
        ? null
        : (100 - currentMem) / pctPerDay

      return { mem: currentMem, pctPerDay, projectedDaysUntilFull }
    },
  )

  app.get('/projects/:name/container-restarts', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const query = HoursQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cutoff = Math.floor(Date.now() / 1000) - query.data.hours * 3600
    const filePath = join(homedir(), 'projects', params.data.name, '.metrics.jsonl')

    const points = await readJsonl<MetricPoint>(
      filePath,
      (p) => typeof p.t === 'number' && p.t >= cutoff && Array.isArray(p.containers) && !('error' in p),
    )

    const result: Record<string, { t: number; restarts: number }[]> = {}
    for (const point of points) {
      for (const c of point.containers) {
        if (!result[c.name]) result[c.name] = []
        result[c.name]!.push({ t: point.t, restarts: c.restarts })
      }
    }
    return result
  })

  app.get('/projects/:name/incidents', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const query = DaysQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: query.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cutoff = Math.floor(Date.now() / 1000) - query.data.days * 24 * 3600
    const filePath = join(homedir(), 'projects', params.data.name, '.incidents.jsonl')

    const records = await readJsonl<IncidentRecord>(
      filePath,
      (r) => typeof r.t === 'number' && r.t >= cutoff && r.type === 'ssh',
    )

    const incidents = pairIncidents(records)

    // Compute MTTR (mean time to recovery)
    const resolvedIncidents = incidents.filter((i) => i.resolved)
    let mttrSec: number | null = null
    if (resolvedIncidents.length > 0) {
      const totalDuration = resolvedIncidents.reduce((sum, i) => sum + (i.durationSec ?? 0), 0)
      mttrSec = totalDuration / resolvedIncidents.length
    }

    // Sort most recent first
    incidents.sort((a, b) => b.startedAt - a.startedAt)

    return { incidents, mttrSec }
  })

  app.get('/projects/:name/deploy-cadence', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const filePath = join(homedir(), 'projects', params.data.name, '.deploy-history.jsonl')
    const all = await readJsonl<DeployHistoryEntry>(filePath)

    // Bucket by date
    const buckets: Record<string, { total: number; failures: number }> = {}
    for (const entry of all) {
      const date = new Date(entry.startedAt).toISOString().slice(0, 10)
      if (!buckets[date]) {
        buckets[date] = { total: 0, failures: 0 }
      }
      buckets[date]!.total += 1
      if (entry.status !== 'success') {
        buckets[date]!.failures += 1
      }
    }

    // Fill in last 30 days
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const days: Array<{ date: string; total: number; failures: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      days.push({
        date: dateStr,
        total: buckets[dateStr]?.total ?? 0,
        failures: buckets[dateStr]?.failures ?? 0,
      })
    }

    return { days }
  })

  app.get('/projects/:name/sla', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })

    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cached = slaCache.get(params.data.name)
    if (cached) return cached

    const filePath = join(homedir(), 'projects', params.data.name, '.incidents.jsonl')
    const records = await readJsonl<IncidentRecord>(
      filePath,
      (r) => typeof r.t === 'number' && r.type === 'ssh',
    )

    const incidents = pairIncidents(records)

    const now = Math.floor(Date.now() / 1000)
    const window7d = 7 * 86400
    const window30d = 30 * 86400
    const cutoff7d = now - window7d
    const cutoff30d = now - window30d

    const computeUptime = (windowSec: number, cutoff: number) => {
      let downtimeSec = 0

      for (const incident of incidents) {
        const startedAt = incident.startedAt
        const resolvedAt = incident.resolvedAt ?? now

        // Check if incident overlaps with the window
        if (resolvedAt <= cutoff) continue // Incident ended before window starts
        if (startedAt >= now) continue // Incident started after now

        // Clamp incident to window
        const clampedStart = Math.max(startedAt, cutoff)
        const clampedEnd = Math.min(resolvedAt, now)
        downtimeSec += clampedEnd - clampedStart
      }

      const uptimePct = ((windowSec - downtimeSec) / windowSec) * 100
      return Math.min(100, Math.max(0, parseFloat(uptimePct.toFixed(2))))
    }

    const result: SlaData = {
      uptime7d: computeUptime(window7d, cutoff7d),
      uptime30d: computeUptime(window30d, cutoff30d),
    }

    slaCache.set(params.data.name, result)
    return result
  })
}
