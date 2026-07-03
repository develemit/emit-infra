import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { findProject, SAFE_NAME_RE } from '../lib/project-helpers.js'

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(SAFE_NAME_RE) })
const AlertsQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) })

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string }; Querystring: unknown }>(
    '/projects/:name/alerts',
    async (req, reply): Promise<void> => {
      const nameCheck = nameSchema.safeParse(req.params)
      if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
      const name = nameCheck.data.name

      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const qsParsed = AlertsQuery.safeParse(req.query)
      if (!qsParsed.success) return void reply.status(400).send({ error: 'invalid query' })
      const { days } = qsParsed.data

      const cutoff = Math.floor(Date.now() / 1000) - days * 86400
      const path = join(homedir(), 'projects', name, '.alerts.jsonl')

      try {
        const raw = await readFile(path, 'utf8')
        const alerts = raw
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line) as { firedAt: number; [k: string]: unknown })
          .filter(a => a.firedAt >= cutoff)
        return void reply.send({ alerts })
      } catch {
        return void reply.send({ alerts: [] })
      }
    },
  )
}
