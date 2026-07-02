import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const NGINX_ENDPOINTS_TTL = 300_000

export interface NginxEndpoint {
  path: string
  requests: number
  errors: number
  errorRate: number
}

type NginxEndpointsResult =
  | { available: false }
  | { available: true; endpoints: NginxEndpoint[] }

const cache = createTtlCache<NginxEndpointsResult | null>(NGINX_ENDPOINTS_TTL)

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

const LOG_FILES = '/var/log/nginx/access.log /var/log/nginx/*-access.log'
const DELIM = '---END1---'

const TOTAL_CMD = `awk '{match($7, /\\"[A-Z]+ ([^ ?]+)/, a); if (a[1]) print a[1]}' ${LOG_FILES} 2>/dev/null | sort | uniq -c | sort -rn | head -20`
const ERROR_CMD = `awk '$9 ~ /^[45]/ {match($7, /\\"[A-Z]+ ([^ ?]+)/, a); if (a[1]) print a[1]}' ${LOG_FILES} 2>/dev/null | sort | uniq -c | sort -rn | head -20`
const SSH_CMD = `${TOTAL_CMD} && echo '${DELIM}' && ${ERROR_CMD}`

function parseCountLines(block: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const spaceIdx = trimmed.indexOf(' ')
    if (spaceIdx === -1) continue
    const count = parseInt(trimmed.slice(0, spaceIdx), 10)
    const path = trimmed.slice(spaceIdx + 1).trim()
    if (!isNaN(count) && path) map.set(path, count)
  }
  return map
}

function parseOutput(raw: string): NginxEndpointsResult {
  const delimIdx = raw.indexOf(DELIM)
  if (delimIdx === -1) return { available: false }

  const block1 = raw.slice(0, delimIdx)
  const block2 = raw.slice(delimIdx + DELIM.length)

  const totalMap = parseCountLines(block1)
  const errorMap = parseCountLines(block2)

  if (totalMap.size === 0) return { available: false }

  const endpoints: NginxEndpoint[] = []
  for (const [path, requests] of totalMap) {
    const errors = errorMap.get(path) ?? 0
    endpoints.push({ path, requests, errors, errorRate: errors / requests })
  }
  endpoints.sort((a, b) => b.requests - a.requests)

  return { available: true, endpoints }
}

export async function nginxEndpointsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>(
    '/projects/:name/nginx-endpoints',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const cached = cache.get(name)
      if (cached !== undefined) {
        if (cached === null) return void reply.status(503).send({ error: 'unreachable' })
        return void reply.send(cached)
      }

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      try {
        const raw = await sshExec(host, SSH_CMD, key)
        const result = parseOutput(raw)
        cache.set(name, result)
        return void reply.send(result)
      } catch {
        cache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
