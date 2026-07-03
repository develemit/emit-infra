import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes } from './routes/projects.js'
import { operationRoutes } from './routes/operations.js'
import { rollbackRoutes } from './routes/rollback.js'
import { secretsSyncRoutes } from './routes/secrets-sync.js'
import { opsRoutes } from './routes/ops.js'
import { billingRoutes } from './routes/billing.js'
import { pushRoutes } from './routes/push.js'
import { historyRoutes } from './routes/history.js'
import { incidentsExportRoutes } from './routes/incidents-export.js'
import { incidentAnnotationRoutes } from './routes/incident-annotations.js'
import { fleetRoutes } from './routes/fleet.js'
import { diskRoutes } from './routes/disk.js'
import { postgresRoutes } from './routes/postgres.js'
import { cronRoutes } from './routes/cron.js'
import { ufwRoutes } from './routes/ufw.js'
import { secretsRoutes } from './routes/secrets.js'
import { responseTimeRoutes } from './routes/response-times.js'
import { certRoutes } from './routes/cert.js'
import { costRoutes } from './routes/cost.js'
import { containerLogsRoutes } from './routes/container-logs.js'
import { nginxEndpointsRoutes } from './routes/nginx-endpoints.js'
import { scaleAdviceRoutes } from './routes/scale-advice.js'
import { startStatusMonitor } from './lib/status-monitor.js'

const app = Fastify({ logger: process.env['NODE_ENV'] === 'development' ? { level: 'warn' } : true })

await app.register(cors, { origin: '*', allowedHeaders: ['Content-Type', 'Authorization'] })

// Shared-secret auth — only active when API_SECRET env var is set (skip in dev)
const API_SECRET = process.env['API_SECRET']
if (API_SECRET) {
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url === '/health') return
    const tokenParam = (req.query as Record<string, string | undefined>)['token']
    const auth = req.headers['authorization'] ?? (tokenParam ? `Bearer ${tokenParam}` : undefined)
    if (auth !== `Bearer ${API_SECRET}`) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
  })
}

app.get('/health', async () => ({ ok: true }))

await app.register(projectRoutes)
await app.register(operationRoutes)
await app.register(rollbackRoutes)
await app.register(secretsSyncRoutes)
await app.register(opsRoutes)
await app.register(billingRoutes)
await app.register(pushRoutes)
await app.register(historyRoutes)
await app.register(incidentsExportRoutes)
await app.register(incidentAnnotationRoutes)
await app.register(fleetRoutes)
await app.register(diskRoutes)
await app.register(postgresRoutes)
await app.register(cronRoutes)
await app.register(ufwRoutes)
await app.register(secretsRoutes)
await app.register(responseTimeRoutes)
await app.register(certRoutes)
await app.register(costRoutes)
await app.register(containerLogsRoutes)
await app.register(nginxEndpointsRoutes)
await app.register(scaleAdviceRoutes)

const port = Number(process.env['PORT'] ?? 7001)
await app.listen({ port, host: '0.0.0.0' })
startStatusMonitor()
