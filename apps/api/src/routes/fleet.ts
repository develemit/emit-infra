import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { discoverProjects } from '../lib/discover-projects.js'
import { readJsonl } from '../lib/jsonl.js'
import { readAnnotations } from '../lib/annotations.js'

const DaysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) })

interface IncidentRecord {
  type: 'ssh' | 'http'
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

interface DeployEntry {
  status: string
  sha: string
  completedAt: string
}

function pairIncidents(records: IncidentRecord[]): Incident[] {
  const out: Incident[] = []
  let downAt: number | null = null
  for (const r of records) {
    if (r.event === 'down' && downAt === null) { downAt = r.t }
    else if (r.event === 'up' && downAt !== null) {
      out.push({ startedAt: downAt, resolvedAt: r.t, durationSec: r.t - downAt, resolved: true })
      downAt = null
    }
  }
  if (downAt !== null) out.push({ startedAt: downAt, resolvedAt: null, durationSec: null, resolved: false })
  return out
}

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/fleet/incidents', async (req, reply) => {
    const query = DaysQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query' })

    const cutoff = Math.floor(Date.now() / 1000) - query.data.days * 86400
    const projects = await discoverProjects()

    const results = await Promise.all(
      projects.map(async (p) => {
        const name = p.config.name
        const dir = join(homedir(), 'projects', name)

        const records = await readJsonl<IncidentRecord>(
          join(dir, '.incidents.jsonl'),
          (r) => typeof r.t === 'number' && r.type === 'ssh' && r.t >= cutoff,
          { tail: 10_000 },
        )

        const paired = pairIncidents(records)
        const annotations = await readAnnotations(join(dir, '.incident-annotations.json'))
        const incidents: Incident[] = paired.map(i => {
          const ann = annotations[String(i.startedAt)]
          const out: Incident = { ...i }
          if (ann?.note !== undefined) out.note = ann.note
          if (ann?.falsePositive !== undefined) out.falsePositive = ann.falsePositive
          return out
        })

        const deploys = await readJsonl<DeployEntry>(
          join(dir, '.deploy-history.jsonl'),
          (d) => typeof d.completedAt === 'string' && new Date(d.completedAt).getTime() / 1000 >= cutoff,
          { tail: 200 },
        )

        return { project: name, incidents, deploys }
      }),
    )

    return results.filter(r => r.incidents.length > 0 || r.deploys.length > 0)
  })
}
