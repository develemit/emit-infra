import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const DRIFT_TTL = 30_000
const EMPTY_MARKER = '__EMIT_INFRA_SECRETS_DRIFT_EMPTY__'

type DriftResult =
  | { status: 'unconfigured' }
  // `present` means set with a non-empty value; empty-valued keys are reported separately.
  | { status: 'ok' | 'drift'; missing: string[]; extra: string[]; present: string[]; empty: string[] }

const driftCache = createTtlCache<DriftResult | null>(DRIFT_TTL)

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

export async function secretsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>(
    '/projects/:name/secrets-drift',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      if (!project.config.requiredEnvKeys) {
        return void reply.send({ status: 'unconfigured' })
      }

      const cached = driftCache.get(name)
      if (cached !== undefined) {
        if (cached === null) return void reply.status(503).send({ error: 'unreachable' })
        return void reply.send(cached)
      }

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain
      const cmd = `grep -v '^#' /opt/${name}/.env 2>/dev/null | grep '=' | cut -d= -f1 | tr -d ' '; echo ${EMPTY_MARKER}; grep -E '^[A-Za-z_][A-Za-z0-9_]*=[[:space:]]*$' /opt/${name}/.env 2>/dev/null | cut -d= -f1 | tr -d ' '`

      try {
        const raw = await sshExec(host, cmd, key)

        const splitIdx = raw.indexOf(EMPTY_MARKER)
        const allKeysRaw = splitIdx === -1 ? raw : raw.slice(0, splitIdx)
        const emptyKeysRaw = splitIdx === -1 ? '' : raw.slice(splitIdx + EMPTY_MARKER.length)

        const serverKeys = new Set(allKeysRaw.split('\n').map(k => k.trim()).filter(Boolean))
        const emptyKeys = new Set(emptyKeysRaw.split('\n').map(k => k.trim()).filter(Boolean))
        const requiredKeys = new Set(project.config.requiredEnvKeys)

        const missing = [...requiredKeys].filter(k => !serverKeys.has(k))
        const extra = [...serverKeys].filter(k => !requiredKeys.has(k))
        const empty = [...requiredKeys].filter(k => emptyKeys.has(k))
        const present = [...requiredKeys].filter(k => serverKeys.has(k) && !emptyKeys.has(k))

        const result: DriftResult = {
          status: missing.length === 0 && empty.length === 0 ? 'ok' : 'drift',
          missing,
          extra,
          present,
          empty,
        }

        driftCache.set(name, result)
        return void reply.send(result)
      } catch {
        driftCache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
