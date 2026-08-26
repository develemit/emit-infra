import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { readJsonl } from '../lib/jsonl.js'
import { findProject } from '../lib/project-helpers.js'
import { computeLinearTrend } from '../lib/trend.js'
import type { MetricPoint } from '../lib/metric-point.js'

const NameParam = z.object({ name: z.string().min(1).max(100) })

export async function trendRoutes(app: FastifyInstance) {
  app.get('/projects/:name/disk-trend', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 3600
    const filePath = join(homedir(), 'projects', params.data.name, '.metrics.jsonl')
    const points = await readJsonl<MetricPoint>(
      filePath,
      (p) => typeof p.t === 'number' && p.t >= cutoff && typeof p.disk === 'number' && !('error' in p),
      { tail: 50_000 },
    )

    const { current, pctPerDay, projectedDaysUntilFull } = computeLinearTrend(points, 'disk')
    return { disk: current, pctPerDay, projectedDaysUntilFull }
  })

  app.get('/projects/:name/memory-trend', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })
    const project = await findProject(params.data.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 3600
    const filePath = join(homedir(), 'projects', params.data.name, '.metrics.jsonl')
    const points = await readJsonl<MetricPoint>(
      filePath,
      (p) => typeof p.t === 'number' && p.t >= cutoff && typeof p.mem === 'number' && !('error' in p),
      { tail: 50_000 },
    )

    const { current, pctPerDay, projectedDaysUntilFull } = computeLinearTrend(points, 'mem')
    return { mem: current, pctPerDay, projectedDaysUntilFull }
  })
}
