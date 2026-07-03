import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { readJsonl } from '../lib/jsonl.js'
import { findProject, SAFE_NAME_RE } from '../lib/project-helpers.js'
import { createTtlCache } from '../lib/ttl-cache.js'

const NameParam = z.object({ name: z.string().regex(SAFE_NAME_RE) })
const ExportQuery = z.object({
  format: z.enum(['json', 'csv']),
  days: z.coerce.number().int().min(1).max(365).default(90),
})

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

function escapeCsvField(value: string | number | boolean | null): string {
  if (value === null) return ''
  const str = String(value)
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatTimestamp(unixSec: number | null): string {
  if (unixSec === null) return ''
  return new Date(unixSec * 1000).toISOString()
}

export async function incidentsExportRoutes(app: FastifyInstance) {
  app.get(
    '/projects/:name/incidents/export',
    async (req, reply) => {
      const params = NameParam.safeParse(req.params)
      if (!params.success) return reply.status(400).send({ error: 'Invalid project name' })

      const query = ExportQuery.safeParse(req.query)
      if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters' })

      const project = await findProject(params.data.name)
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      const cutoff = Math.floor(Date.now() / 1000) - query.data.days * 24 * 3600
      const filePath = join(homedir(), 'projects', params.data.name, '.incidents.jsonl')

      const records = await readJsonl<IncidentRecord>(
        filePath,
        (r) => typeof r.t === 'number' && r.t >= cutoff && r.type === 'ssh',
        { tail: 50_000 },
      )

      const incidents = pairIncidents(records)
      incidents.sort((a, b) => a.startedAt - b.startedAt)

      if (query.data.format === 'json') {
        const json = incidents.map(i => ({
          startedAt: formatTimestamp(i.startedAt),
          resolvedAt: formatTimestamp(i.resolvedAt),
          durationSec: i.durationSec,
          resolved: i.resolved,
        }))
        return reply.type('application/json').send(JSON.stringify(json, null, 2))
      }

      // CSV format
      const lines: string[] = ['startedAt,resolvedAt,durationSec,resolved']
      for (const incident of incidents) {
        const row = [
          escapeCsvField(formatTimestamp(incident.startedAt)),
          escapeCsvField(formatTimestamp(incident.resolvedAt)),
          escapeCsvField(incident.durationSec),
          escapeCsvField(incident.resolved),
        ].join(',')
        lines.push(row)
      }

      const csv = lines.join('\n')
      return reply
        .type('text/csv')
        .header('content-disposition', `attachment; filename="${params.data.name}-incidents.csv"`)
        .send(csv)
    },
  )
}
