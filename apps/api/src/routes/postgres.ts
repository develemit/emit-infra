import type { FastifyInstance } from 'fastify'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'

const PG_TABLE_SIZES_TTL = 60_000

type TableSizeData = {
  tables: Array<{ name: string; totalBytes: number; rowEstimate: number }>
}

const pgTableSizesCache = createTtlCache<TableSizeData | null>(PG_TABLE_SIZES_TTL)

export async function postgresRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>('/projects/:name/pg-table-sizes', async (req, reply): Promise<void> => {
    const project = await findProject(req.params.name)
    if (!project) return void reply.status(404).send({ error: 'not found' })
    if (!project.config.postgres) return void reply.status(404).send({ error: 'postgres not configured' })

    const cached = pgTableSizesCache.get(req.params.name)
    if (cached !== undefined) {
      return void (cached ? reply.send(cached) : reply.status(503).send({ error: 'unreachable' }))
    }

    const key = sshKeyPath(project.config.sshKeyName)
    const host = project.config.serverIp ?? project.config.domain

    try {
      const raw = await sshExec(
        host,
        `cd /opt/${req.params.name} && docker compose exec -T postgres psql -U postgres -t -A -F'\\t' -c "SELECT schemaname||'.'||tablename, pg_total_relation_size(quote_ident(schemaname)||'.'||quote_ident(tablename)), reltuples::bigint FROM pg_tables WHERE schemaname='public' ORDER BY 2 DESC LIMIT 10"`,
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
      pgTableSizesCache.set(req.params.name, data)
      return void reply.send(data)
    } catch {
      pgTableSizesCache.set(req.params.name, null)
      return void reply.status(503).send({ error: 'unreachable' })
    }
  })
}
