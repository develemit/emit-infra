import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { readJsonl } from '../lib/jsonl.js'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject } from '../lib/project-helpers.js'
import { getServerTypeMonthlyPrice } from '../lib/hetzner.js'

const NameParam = z.object({ name: z.string().min(1).max(100) })

const CX_TIERS = ['cx22', 'cx32', 'cx42', 'cx52'] as const

const SCALE_ADVICE_TTL = 600_000

interface MetricPoint {
  t: number
  disk: number
  memory: number
}

export interface ScaleAdvice {
  resource: 'disk' | 'memory'
  sustainedPct: number
  currentTier: string
  nextTier: string | null
  currentEurMonth: number | null
  nextEurMonth: number | null
  note?: 'disk'
}

type ScaleAdviceResult =
  | { advice: null }
  | { advice: ScaleAdvice }

const cache = createTtlCache<ScaleAdviceResult>(SCALE_ADVICE_TTL)

function findSustainedResource(
  points: MetricPoint[],
  threshold: number,
  consecutiveRequired: number,
): 'disk' | 'memory' | null {
  const last = points.slice(-12)
  if (last.length < consecutiveRequired) return null

  let diskStreak = 0
  let memStreak = 0
  for (const p of last) {
    diskStreak = p.disk >= threshold ? diskStreak + 1 : 0
    memStreak = p.memory >= threshold ? memStreak + 1 : 0
  }

  if (diskStreak >= consecutiveRequired) return 'disk'
  if (memStreak >= consecutiveRequired) return 'memory'
  return null
}

export async function scaleAdviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:name/scale-advice', async (req, reply) => {
    const params = NameParam.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: params.error.message })

    const name = params.data.name
    const project = await findProject(name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const cached = cache.get(name)
    if (cached !== undefined) return cached

    const filePath = join(homedir(), 'projects', name, '.metrics.jsonl')
    const points = await readJsonl<MetricPoint>(
      filePath,
      (p): p is MetricPoint =>
        typeof p.t === 'number' &&
        typeof p.disk === 'number' &&
        typeof (p as MetricPoint).memory === 'number' &&
        !('error' in p),
    )

    const resource = findSustainedResource(points, 80, 6)
    if (!resource) {
      const result: ScaleAdviceResult = { advice: null }
      cache.set(name, result)
      return result
    }

    const lastPoint = points[points.length - 1]
    const sustainedPct = resource === 'disk'
      ? (lastPoint?.disk ?? 0)
      : (lastPoint?.memory ?? 0)

    const currentTier = (project.config.serverType ?? 'cx22').toLowerCase()
    const region = project.config.region ?? 'nbg1'

    const tierIdx = CX_TIERS.indexOf(currentTier as typeof CX_TIERS[number])
    const nextTier: string | null = tierIdx !== -1 && tierIdx < CX_TIERS.length - 1
      ? CX_TIERS[tierIdx + 1] ?? null
      : null

    const [currentEurMonth, nextEurMonth] = await Promise.all([
      getServerTypeMonthlyPrice(currentTier, region),
      nextTier ? getServerTypeMonthlyPrice(nextTier, region) : Promise.resolve(null),
    ])

    const advice: ScaleAdvice = {
      resource,
      sustainedPct,
      currentTier,
      nextTier,
      currentEurMonth,
      nextEurMonth,
      ...(resource === 'disk' ? { note: 'disk' } : {}),
    }

    const result: ScaleAdviceResult = { advice }
    cache.set(name, result)
    return result
  })
}
