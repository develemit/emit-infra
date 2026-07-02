import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath, SAFE_NAME_RE } from '../lib/project-helpers.js'

const PG_TABLE_SIZES_TTL = 60_000

type TableSizeData = {
  tables: Array<{ name: string; totalBytes: number; rowEstimate: number }>
}

const pgTableSizesCache = createTtlCache<TableSizeData | null>(PG_TABLE_SIZES_TTL)

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(SAFE_NAME_RE, 'invalid project name') })

export async function postgresRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>('/projects/:name/pg-table-sizes', async (req, reply): Promise<void> => {
    const nameCheck = nameSchema.safeParse(req.params)
    if (!nameCheck.success) return void reply.status(400).send({ error: 'invalid params' })
    const name = nameCheck.data.name
    const project = await findProject(name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    if (!project.config.postgres) return void reply.status(404).send({ error: 'postgres not configured' })

    const cached = pgTableSizesCache.get(name)
    if (cached !== undefined) {
      return void (cached ? reply.send(cached) : reply.status(503).send({ error: 'unreachable' }))
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const raw = await sshExec(
        host,
        `cd /opt/${name} && docker compose exec -T postgres psql -U postgres -t -A -F'\\t' -c "SELECT schemaname||'.'||tablename, pg_total_relation_size(quote_ident(schemaname)||'.'||quote_ident(tablename)), reltuples::bigint FROM pg_tables WHERE schemaname='public' ORDER BY 2 DESC LIMIT 10"`,
        key,
      )

      const tables = raw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split('\t')
          if (parts.length < 3) return null
          const [name, totalBytesStr, rowEstimateStr] = parts
          if (!name || !totalBytesStr || !rowEstimateStr) return null
          return {
            name: name ?? '',
            totalBytes: parseInt(totalBytesStr ?? '0', 10),
            rowEstimate: parseInt(rowEstimateStr ?? '0', 10),
          }
        })
        .filter((t): t is { name: string; totalBytes: number; rowEstimate: number } => t !== null)

      const data: TableSizeData = { tables }
      pgTableSizesCache.set(name, data)
      return void reply.send(data)
    } catch {
      pgTableSizesCache.set(name, null)
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })
}
