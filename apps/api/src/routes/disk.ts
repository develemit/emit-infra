import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const DIRS_TTL = 60_000

export interface DiskDir {
  path: string
  bytes: number
}

const dirsCache = createTtlCache<DiskDir[] | null>(DIRS_TTL)

export async function diskRoutes(app: FastifyInstance): Promise<void> {
  const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

  app.get<{ Params: { name: string } }>(
    '/projects/:name/disk-dirs',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) {
        return void reply.status(400).send({ error: 'invalid params' })
      }

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) {
        return void reply.status(404).send({ error: 'not found' })
      }

      const cached = dirsCache.get(name)
      if (cached !== undefined) {
        return void reply.send({ dirs: cached ?? [] })
      }

      const key = sshKeyPath(project.config.sshKeyName)
      const host = project.config.serverIp ?? project.config.domain

      try {
        const raw = await sshExec(
          host,
          'sudo du -sb /app /var/log /var/lib/postgresql /var/lib/docker /home /tmp 2>/dev/null | sort -rn',
          key,
        )

        const dirs: DiskDir[] = raw
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const parts = line.split('\t')
            if (parts.length < 2) return null
            const bytes = parseInt(parts[0] ?? '0', 10)
            const path = parts[1]?.trim()
            if (!path || Number.isNaN(bytes)) return null
            return { path, bytes }
          })
          .filter((item): item is DiskDir => item !== null)
          .sort((a, b) => b.bytes - a.bytes)

        dirsCache.set(name, dirs)
        return void reply.send({ dirs })
      } catch {
        dirsCache.set(name, null)
        return void reply.status(503).send({ error: 'unreachable' })
      }
    },
  )
}
