import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const RT_TTL = 120_000

type ResponseTimeResult =
  | { available: false }
  | { available: true; p50ms: number; p95ms: number; p99ms: number; sampleCount: number }

const rtCache = createTtlCache<ResponseTimeResult | null>(RT_TTL)

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

// awk pipeline: extract second-to-last field (request_time in seconds), sort, then compute percentiles
const NGINX_CMD =
  "awk 'NF>=10 {rt=$(NF-1); if(rt+0==rt && rt>0) print rt}' /var/log/nginx/access.log /var/log/nginx/*-access.log 2>/dev/null" +
  " | sort -n" +
  " | awk 'BEGIN{c=0} {a[++c]=$1} END{if(c>0){p50=a[int(c*0.50)+1]; p95=a[int(c*0.95)+1]; p99=a[int(c*0.99)+1]; printf \"%.3f %.3f %.3f %d\\n\",p50,p95,p99,c}}'"

function parseRtOutput(raw: string): ResponseTimeResult {
  const trimmed = raw.trim()
  if (!trimmed) return { available: false }

  const parts = trimmed.split(/\s+/)
  if (parts.length < 4) return { available: false }

  const p50 = parseFloat(parts[0] ?? '')
  const p95 = parseFloat(parts[1] ?? '')
  const p99 = parseFloat(parts[2] ?? '')
  const count = parseInt(parts[3] ?? '', 10)

  if (isNaN(p50) || isNaN(p95) || isNaN(p99) || isNaN(count) || count === 0) {
    return { available: false }
  }

  return {
    available: true,
    p50ms: Math.round(p50 * 1000),
    p95ms: Math.round(p95 * 1000),
    p99ms: Math.round(p99 * 1000),
    sampleCount: count,
  }
}

export async function responseTimeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>(
    '/projects/:name/response-times',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const cached = rtCache.get(name)
      if (cached !== undefined) {
        if (cached === null) return void reply.status(503).send({ error: 'unreachable' })
        return void reply.send(cached)
      }

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      try {
        const raw = await sshExec(host, NGINX_CMD, key)
        const result = parseRtOutput(raw)
        rtCache.set(name, result)
        return void reply.send(result)
      } catch {
        rtCache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
