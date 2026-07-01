import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sshExec } from '@emit-infra/core'
import { createTtlCache } from '../lib/ttl-cache.js'
import { findProject, sshKeyPath } from '../lib/project-helpers.js'
import { getServerTypeMonthlyPrice } from '../lib/hetzner.js'

const COST_TTL = 3_600_000
const R2_PRICE_PER_GB_MONTH = 0.015

interface CostEstimate {
  server: { eurPerMonth: number | null; type: string; region: string }
  storage: { usdPerMonth: number | null; totalBytes: number | null; bucketName: string | null }
}

const costCache = createTtlCache<CostEstimate>(COST_TTL)

const nameSchema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) })

export async function costRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { name: string } }>(
    '/projects/:name/cost',
    async (req, reply): Promise<void> => {
      const parsed = nameSchema.safeParse(req.params)
      if (!parsed.success) return void reply.status(400).send({ error: 'invalid params' })

      const name = parsed.data.name
      const project = await findProject(name)
      if (!project) return void reply.status(404).send({ error: 'not found' })

      const cached = costCache.get(name)
      if (cached !== undefined) return void reply.send(cached)

      const { serverType, region } = project.config

      // Server cost — null on any failure, never throws
      const eurPerMonth = await getServerTypeMonthlyPrice(serverType, region).catch(() => null)

      // Storage cost — null if no bucket configured, null on SSH failure
      const bucket = project.config.postgres?.backupBucket ?? null
      let totalBytes: number | null = null
      let usdPerMonth: number | null = null

      if (bucket) {
        try {
          const key = sshKeyPath(project.config.sshKeyName)
          const host = project.config.serverIp ?? project.config.domain
          const cmd =
            `source /opt/${name}/.env && AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"` +
            ` AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="auto"` +
            ` aws s3 ls "s3://${bucket}/"` +
            ` --endpoint-url "https://$CF_ACCOUNT_ID.r2.cloudflarestorage.com"`

          const raw = await sshExec(host, cmd, key)
          totalBytes = raw
            .split('\n')
            .filter(l => l.trim())
            .reduce((sum, line) => {
              const parts = line.trim().split(/\s+/)
              const size = parseInt(parts[2] ?? '', 10)
              return sum + (isNaN(size) ? 0 : size)
            }, 0)

          usdPerMonth = (totalBytes / (1024 ** 3)) * R2_PRICE_PER_GB_MONTH
        } catch {
          // Leave totalBytes and usdPerMonth as null — partial data is fine
        }
      }

      const result: CostEstimate = {
        server: { eurPerMonth, type: serverType, region },
        storage: { usdPerMonth, totalBytes, bucketName: bucket },
      }

      costCache.set(name, result)
      return void reply.send(result)
    },
  )
}
