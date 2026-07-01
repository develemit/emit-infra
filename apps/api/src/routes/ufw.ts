import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const UFW_TTL = 120_000

export interface UfwRule {
  num: number
  to: string
  action: string
  from: string
}

export interface UfwStatus {
  status: 'active' | 'inactive'
  rules: UfwRule[]
}

const ufwCache = createTtlCache<UfwStatus | null>(UFW_TTL)

const UFW_RULE_RE = /^\[\s*(\d+)\]\s+(\S+)\s+(ALLOW|DENY|REJECT)\s+(IN|OUT|FWD)?\s+(.+)$/i
const STATUS_RE = /^Status:\s*(active|inactive)\s*$/i

function parseUfwOutput(raw: string): UfwStatus {
  const lines = raw.split('\n')
  let status: 'active' | 'inactive' = 'inactive'
  const rules: UfwRule[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const statusMatch = STATUS_RE.exec(trimmed)
    if (statusMatch) {
      status = statusMatch[1] === 'active' ? 'active' : 'inactive'
      continue
    }

    const ruleMatch = UFW_RULE_RE.exec(trimmed)
    if (ruleMatch) {
      const num = parseInt(ruleMatch[1] ?? '0', 10)
      const to = ruleMatch[2] ?? ''
      const action = ruleMatch[3] ?? 'ALLOW'
      const from = ruleMatch[5] ?? ''

      rules.push({
        num,
        to,
        action: action.toUpperCase(),
        from,
      })
    }
  }

  return { status, rules }
}

export async function ufwRoutes(app: FastifyInstance): Promise<void> {
  const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

  app.get<{ Params: { name: string } }>(
    '/projects/:name/ufw-rules',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const cached = ufwCache.get(name)
      if (cached !== undefined) return void reply.send(cached ?? { status: 'inactive', rules: [] })

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      const cmd = 'sudo ufw status numbered 2>/dev/null'

      try {
        const raw = await sshExec(host, cmd, key)
        const result = parseUfwOutput(raw)
        ufwCache.set(name, result)
        return void reply.send(result)
      } catch {
        ufwCache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
