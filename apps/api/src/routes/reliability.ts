import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { readJsonl } from '../lib/jsonl.js'
import { findProject } from '../lib/project-helpers.js'
import { createTtlCache } from '../lib/ttl-cache.js'
import { readAnnotations } from '../lib/annotations.js'

const NameParam = z.object({ name: z.string().min(1).max(100) })
const DaysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) })

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
  note?: string
  falsePositive?: boolean
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

export async function reliabilityRoutes(app: FastifyInstance) {
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
      { tail: 50_000 },
    )

    const paired = pairIncidents(records)
    const annotationsPath = join(homedir(), 'projects', params.data.name, '.incident-annotations.json')
    const annotations = await readAnnotations(annotationsPath)

    const incidents: Incident[] = paired.map(i => {
      const ann = annotations[String(i.startedAt)]
      const out: Incident = { ...i }
      if (ann?.note !== undefined) out.note = ann.note
      if (ann?.falsePositive !== undefined) out.falsePositive = ann.falsePositive
      return out
    })

    // Compute MTTR excluding false positives
    const resolvedReal = incidents.filter((i) => i.resolved && !i.falsePositive)
    let mttrSec: number | null = null
    if (resolvedReal.length > 0) {
      const totalDuration = resolvedReal.reduce((sum, i) => sum + (i.durationSec ?? 0), 0)
      mttrSec = totalDuration / resolvedReal.length
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
    const all = await readJsonl<DeployHistoryEntry>(filePath, undefined, { tail: 50_000 })

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
      { tail: 50_000 },
    )

    const paired = pairIncidents(records)
    const annotationsPath = join(homedir(), 'projects', params.data.name, '.incident-annotations.json')
    const annotations = await readAnnotations(annotationsPath)
    const incidents = paired.filter(i => !annotations[String(i.startedAt)]?.falsePositive)

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
