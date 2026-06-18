import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readJsonl, downsample } from '../lib/jsonl.js'
import { findProject } from '../lib/project-helpers.js'

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
}

interface CiHistoryEntry {
  status: string
  sha: string
  branch: string
  startedAt: string
  completedAt: string
  durationSec: number
}

const MAX_METRIC_POINTS = 500
const MAX_HOURS = 720
const MAX_HISTORY_LIMIT = 200

export async function historyRoutes(app: FastifyInstance) {
  app.get<{
    Params: { name: string }
    Querystring: { hours?: string }
  }>('/projects/:name/metrics', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const hours = Math.min(
      Math.max(Number(req.query.hours) || 24, 1),
      MAX_HOURS,
    )
    const cutoff = Math.floor(Date.now() / 1000) - hours * 3600
    const filePath = join(homedir(), 'projects', req.params.name, '.metrics.jsonl')

    const points = await readJsonl<MetricPoint>(
      filePath,
      (p) => typeof p.t === 'number' && p.t >= cutoff && !('error' in p),
    )

    const downsampled = downsample(points, MAX_METRIC_POINTS)
    const from = points.length > 0 ? points[0]!.t : cutoff
    const to = points.length > 0 ? points[points.length - 1]!.t : Math.floor(Date.now() / 1000)

    return { points: downsampled, range: { from, to } }
  })

  app.get<{
    Params: { name: string }
    Querystring: { limit?: string }
  }>('/projects/:name/deploy-history', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      MAX_HISTORY_LIMIT,
    )
    const filePath = join(homedir(), 'projects', req.params.name, '.deploy-history.jsonl')

    const all = await readJsonl<DeployHistoryEntry>(filePath)
    const deploys = all.slice(-limit).reverse()

    return { deploys }
  })

  app.get<{
    Params: { name: string }
    Querystring: { limit?: string }
  }>('/projects/:name/ci-history', async (req, reply) => {
    const project = await findProject(req.params.name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      MAX_HISTORY_LIMIT,
    )
    const filePath = join(homedir(), 'projects', req.params.name, '.ci-history.jsonl')

    const all = await readJsonl<CiHistoryEntry>(filePath)
    const runs = all.slice(-limit).reverse()

    return { runs }
  })
}
